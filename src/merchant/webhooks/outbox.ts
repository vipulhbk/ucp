import { createHash, randomUUID } from "node:crypto";
import { Recorder, merchantLogKey } from "@/observability/recorder";
import type { Store } from "@/persistence/store";
import { signRequest } from "@/ucp/http-signatures";
import { generateSigningKey, type SigningKey } from "@/ucp/keys";
import { safeFetch, SafeFetchError } from "@/ucp/safe-fetch";
import { serializeUcpAgent } from "@/ucp/ucp-agent";

/**
 * Business → platform order webhooks (spec: shopping/order/index.md → Events).
 * The exact bytes that were signed are stored with the row, so a retry or re-delivery is byte-identical.
 * Delivery is at-least-once with bounded retries; the platform dedupes by `Webhook-Id`.
 */
export type AttackKind = "tamper_body" | "bad_signature" | "unknown_key" | "stale_timestamp" | "wrong_signer";
export const ATTACK_KINDS: AttackKind[] = ["tamper_body", "bad_signature", "unknown_key", "stale_timestamp", "wrong_signer"];

export interface Attempt {
  at: number;
  ok: boolean;
  status?: number;
  error?: string;
  durationMs: number;
  /** Set when this was a deliberate security demonstration, not a real delivery attempt. */
  attack?: AttackKind;
  /** A duplicate delivery of an already-sent event (same Webhook-Id); not a retry. */
  redelivery?: boolean;
  keyid?: string;
  ack?: unknown;
}

export interface OutboxRow {
  id: string; // = Webhook-Id
  platformId: string;
  orderId: string;
  orderVersion: number;
  summary: string;
  webhookUrl: string;
  /** The exact bytes signed and sent. */
  body: string;
  createdAt: number;
  status: "pending" | "delivered" | "dead";
  attempts: Attempt[];
  nextAt: number;
}

export const MAX_ATTEMPTS = 6;
/** Delay before attempt N+1 after the Nth failed attempt. */
export const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 3_600_000];

export interface OutboxDeps {
  store: Store;
  origin: string;
  signingKey: SigningKey;
  allowedOrigins: string[];
  devLoopbackHosts: string[];
  now: () => number;
  /** Test seam: platform-side fetch behaviour. */
  fetchImpl?: typeof safeFetch;
}

export const rowKey = (pid: string, id: string) => `m:${pid}:ox:${id}`;
export const queueKey = (pid: string) => `m:${pid}:oxq`;
export const indexKey = (pid: string) => `m:${pid}:oxidx`;
export const GLOBAL_DUE = "ox:due";

export async function enqueue(deps: Pick<OutboxDeps, "store" | "now">, args: { platformId: string; orderId: string; orderVersion: number; webhookUrl: string; body: string; summary: string }): Promise<OutboxRow> {
  const row: OutboxRow = {
    id: `whk_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    platformId: args.platformId,
    orderId: args.orderId,
    orderVersion: args.orderVersion,
    summary: args.summary,
    webhookUrl: args.webhookUrl,
    body: args.body,
    createdAt: deps.now(),
    status: "pending",
    attempts: [],
    nextAt: deps.now(),
  };
  await deps.store.set(rowKey(args.platformId, row.id), row);
  await deps.store.zAdd(queueKey(args.platformId), row.nextAt, row.id);
  await deps.store.zAdd(GLOBAL_DUE, row.nextAt, `${args.platformId}|${row.id}`);
  await deps.store.listPush(indexKey(args.platformId), row.id, { max: 500 });
  return row;
}

function buildRequest(deps: OutboxDeps, row: OutboxRow, attack?: AttackKind) {
  const tsNow = Math.floor(deps.now() / 1000);
  const ts = attack === "stale_timestamp" ? tsNow - 3600 : tsNow;
  const businessProfileUrl = attack === "wrong_signer" ? `${deps.origin}/.well-known/ucp?as=other-identity` : `${deps.origin}/.well-known/ucp`;
  let key = deps.signingKey;
  if (attack === "unknown_key") key = generateSigningKey("ES256");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "ucp-agent": serializeUcpAgent(businessProfileUrl),
    "webhook-id": row.id,
    "webhook-timestamp": String(ts),
  };
  let signKey = key;
  if (attack === "bad_signature") signKey = { ...key, privateKey: generateSigningKey("ES256").privateKey }; // real kid, wrong private key
  // `created` is always fresh: for stale_timestamp the signature itself is valid, so the Webhook-Timestamp window is what must stop it.
  const sig = signRequest({ method: "POST", url: row.webhookUrl, headers, body: row.body, key: signKey, extraComponents: ["webhook-id", "webhook-timestamp"], created: tsNow });
  let body = row.body;
  if (attack === "tamper_body") body = row.body.replace(/"label":"([^"])/, (_m, c: string) => `"label":"${c === "X" ? "Y" : "X"}`); // changed after signing
  return { headers: { ...headers, ...sig }, body, keyid: signKey.kid };
}

async function attempt(deps: OutboxDeps, row: OutboxRow, attack?: AttackKind, redelivery = false): Promise<Attempt> {
  const started = deps.now();
  const t0 = Date.now();
  const { headers, body, keyid } = buildRequest(deps, row, attack);
  let a: Attempt;
  let resHeaders: Record<string, string> | undefined;
  try {
    const res = await (deps.fetchImpl ?? safeFetch)(row.webhookUrl, { method: "POST", headers, body, allowedOrigins: deps.allowedOrigins, devLoopbackHosts: deps.devLoopbackHosts, timeoutMs: 5000 });
    resHeaders = res.headers;
    let ack: unknown;
    try {
      ack = JSON.parse(res.bodyText);
    } catch {
      ack = res.bodyText.slice(0, 500);
    }
    a = { at: started, ok: res.status >= 200 && res.status < 300, status: res.status, durationMs: Date.now() - t0, ack, keyid, ...(attack ? { attack } : {}) };
  } catch (e) {
    const err = e instanceof SafeFetchError ? e : new SafeFetchError("network", (e as Error).message);
    a = { at: started, ok: false, error: `${err.code}: ${err.message}`, durationMs: Date.now() - t0, keyid, ...(attack ? { attack } : {}) };
  }
  // The sender's side of the exchange, for the Protocol Inspector (joined to the receiver's by Webhook-Id).
  let parsed: unknown = body;
  try {
    parsed = JSON.parse(body);
  } catch {
    /* keep the raw string */
  }
  await new Recorder(deps.store, merchantLogKey).record({
    id: randomUUID(),
    sid: row.platformId,
    correlationId: row.id,
    ts: new Date(started).toISOString(),
    actor: "business",
    op: "order_event_webhook",
    method: "POST",
    url: row.webhookUrl,
    requestHeaders: headers,
    requestBody: parsed,
    status: a.status,
    responseHeaders: resHeaders,
    responseBody: a.ack,
    durationMs: a.durationMs,
    validation: [],
    error: a.error ? { kind: "delivery_failed", message: a.error } : undefined,
    note: attack ? `SECURITY DEMO (${attack}): the business is playing an attacker` : redelivery ? "Redelivery with the same Webhook-Id (a duplicate)" : `${row.summary}; attempt ${row.attempts.length + 1}`,
    replayable: false,
  });
  return a;
}

/** One real delivery attempt for a pending row (serialized per row; honours the retry schedule). */
export async function deliver(deps: OutboxDeps, platformId: string, id: string, opts: { force?: boolean } = {}): Promise<OutboxRow | null> {
  return deps.store.withLock(rowKey(platformId, id), async () => {
    const row = await deps.store.get<OutboxRow>(rowKey(platformId, id));
    if (!row || row.status !== "pending") return row;
    if (!opts.force && row.nextAt > deps.now()) return row;
    const a = await attempt(deps, row);
    row.attempts.push(a);
    if (a.ok) {
      row.status = "delivered";
      await deps.store.zRem(queueKey(platformId), id);
      await deps.store.zRem(GLOBAL_DUE, `${platformId}|${id}`);
    } else if (row.attempts.filter((x) => !x.attack && !x.redelivery).length >= MAX_ATTEMPTS) {
      row.status = "dead";
      await deps.store.zRem(queueKey(platformId), id);
      await deps.store.zRem(GLOBAL_DUE, `${platformId}|${id}`);
    } else {
      const n = row.attempts.filter((x) => !x.attack && !x.redelivery).length;
      row.nextAt = deps.now() + BACKOFF_MS[Math.min(n - 1, BACKOFF_MS.length - 1)]!;
      await deps.store.zAdd(queueKey(platformId), row.nextAt, id);
      await deps.store.zAdd(GLOBAL_DUE, row.nextAt, `${platformId}|${id}`);
    }
    await deps.store.set(rowKey(platformId, id), row);
    return row;
  });
}

/** Deliver everything that is due for one platform. `force` ignores the backoff schedule ("retry now"). */
export async function flush(deps: OutboxDeps, platformId: string, opts: { force?: boolean; limit?: number } = {}): Promise<OutboxRow[]> {
  const ids = await deps.store.zDue(queueKey(platformId), opts.force ? Number.MAX_SAFE_INTEGER : deps.now(), opts.limit ?? 25);
  const out: OutboxRow[] = [];
  for (const id of ids) {
    const r = await deliver(deps, platformId, id, { force: opts.force });
    if (r) out.push(r);
  }
  return out;
}

/** Cron entry point: deliver due rows across all platforms. */
export async function flushAllDue(deps: OutboxDeps, limit = 50): Promise<number> {
  const members = await deps.store.zDue(GLOBAL_DUE, deps.now(), limit);
  let n = 0;
  for (const m of members) {
    const [pid, id] = m.split("|") as [string, string];
    await deliver(deps, pid, id);
    n++;
  }
  return n;
}

/**
 * Send the stored payload again with the SAME Webhook-Id (a duplicate delivery), or send a deliberately broken variant
 * to demonstrate the platform's checks. Neither changes the row's real delivery state.
 */
export async function sendExtra(deps: OutboxDeps, platformId: string, id: string, mode: "redeliver" | AttackKind): Promise<{ row: OutboxRow; attempt: Attempt } | null> {
  return deps.store.withLock(rowKey(platformId, id), async () => {
    const row = await deps.store.get<OutboxRow>(rowKey(platformId, id));
    if (!row) return null;
    const a = await attempt(deps, row, mode === "redeliver" ? undefined : mode, mode === "redeliver");
    row.attempts.push(mode === "redeliver" ? { ...a, redelivery: true } : a);
    await deps.store.set(rowKey(platformId, id), row);
    return { row, attempt: a };
  });
}

export async function listRows(store: Store, platformId: string): Promise<OutboxRow[]> {
  const ids = await store.listRange<string>(indexKey(platformId));
  const rows = await Promise.all(ids.map((id) => store.get<OutboxRow>(rowKey(platformId, id))));
  return rows.filter((r): r is OutboxRow => r !== null);
}

export const bodyHash = (body: string) => createHash("sha256").update(body).digest("hex").slice(0, 16);

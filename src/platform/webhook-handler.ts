import { createHash, randomUUID } from "node:crypto";
import { redactHeaders } from "@/observability/redact";
import { Recorder } from "@/observability/recorder";
import type { Store } from "@/persistence/store";
import { UCP_VERSION } from "@/ucp/constants";
import { VERIFY_HTTP, verifyRequest, type PublicKeyLike } from "@/ucp/http-signatures";
import { ProfileBusinessSchema, OrderSchema } from "@/ucp/schemas";
import { safeFetch, SafeFetchError, type SafeFetchOptions } from "@/ucp/safe-fetch";
import { parseUcpAgent } from "@/ucp/ucp-agent";
import { issuesOf } from "@/ucp/validate";
import { ownKey, receiptIndex, receiptKey, seenKey, snapIndex, snapKey, type OrderSnapshot, type Ownership, type WebhookReceipt } from "./orders";
import { PLATFORM_ID_RE } from "./profile-variants";

export const TIMESTAMP_WINDOW_SEC = 300;

export interface ReceiverDeps {
  store: Store;
  fetchOptions: Pick<SafeFetchOptions, "allowedOrigins" | "devLoopbackHosts" | "resolve">;
  now: () => number;
}

export interface WebhookInput {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Buffer;
}

export interface WebhookResponse {
  status: number;
  body: unknown;
  /** Work to run AFTER the 2xx ack (spec: respond quickly, process asynchronously). */
  process?: () => Promise<void>;
}

interface BusinessKeys {
  keys: (PublicKeyLike & { kid: string })[];
}

async function businessKeys(deps: ReceiverDeps, profileUrl: string, forceRefresh: boolean): Promise<BusinessKeys> {
  const ck = `cache:business-profile:${createHash("sha256").update(profileUrl).digest("hex").slice(0, 32)}`;
  if (!forceRefresh) {
    const hit = await deps.store.get<BusinessKeys>(ck);
    if (hit) return hit;
  }
  const res = await safeFetch(profileUrl, { ...deps.fetchOptions, timeoutMs: 5000 });
  if (res.status !== 200) throw new SafeFetchError("network", `profile fetch returned HTTP ${res.status}`);
  const json = JSON.parse(res.bodyText) as unknown;
  const parsed = ProfileBusinessSchema.safeParse(json);
  if (!parsed.success) throw new SafeFetchError("network", "business profile failed schema validation");
  const keys = ((json as { keys?: (PublicKeyLike & { kid: string })[] }).keys ?? []).filter((k) => typeof k.kid === "string");
  const v = { keys };
  await deps.store.set(ck, v, { ttlSec: 300 });
  return v;
}

/**
 * Platform order-webhook receiver. Pipeline (spec: order/index.md → Webhook Signature Verification):
 *   headers → signer profile → RFC 9421 signature (key from the signer's `keys[]`) → timestamp window → payload schema →
 *   AUTHORIZATION (signer must be the business that owns the order) → dedupe by Webhook-Id → ack → apply asynchronously.
 * Rejected deliveries never consume a Webhook-Id, so an attacker cannot pre-poison ids.
 */
export async function receiveOrderWebhook(deps: ReceiverDeps, platformId: string, input: WebhookInput): Promise<WebhookResponse> {
  const t0 = Date.now();
  const res = await receive(deps, platformId, input);
  await logReceived(deps, platformId, input, res, Date.now() - t0);
  return res;
}

export const platformLogKey = (platformId: string) => `p:${platformId}:log`;

/** The receiver's side of the exchange for the Protocol Inspector (joined to the sender's by Webhook-Id). */
async function logReceived(deps: ReceiverDeps, platformId: string, input: WebhookInput, res: WebhookResponse, durationMs: number): Promise<void> {
  const h = Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]));
  let body: unknown = input.body.toString("utf8").slice(0, 20_000);
  let order: ReturnType<typeof OrderSchema.safeParse> | undefined;
  try {
    body = JSON.parse(body as string);
    order = OrderSchema.safeParse(body);
  } catch {
    /* keep raw text */
  }
  const code = (res.body as { messages?: { code?: string }[] }).messages?.[0]?.code;
  await new Recorder(deps.store, platformLogKey).record({
    id: randomUUID(),
    sid: platformId,
    correlationId: h["webhook-id"] ?? `wh_${randomUUID().slice(0, 8)}`,
    ts: new Date(deps.now() - durationMs).toISOString(),
    actor: "platform",
    op: "order_event_webhook",
    method: input.method,
    url: input.url,
    requestHeaders: input.headers,
    requestBody: body,
    status: res.status,
    responseBody: res.body,
    durationMs,
    validation: order ? [{ target: "request", schema: "Order (webhook payload)", ok: order.success, issues: order.success ? [] : issuesOf(order.error.issues) }] : [],
    note: code ? `REJECTED by the receiver: ${code}` : "Accepted: signature verified, signer authorized, deduplicated, acknowledged",
    replayable: false,
  });
}

async function receive(deps: ReceiverDeps, platformId: string, input: WebhookInput): Promise<WebhookResponse> {
  const store = deps.store;
  const now = deps.now();
  const h = Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]));
  const base = (): Omit<WebhookReceipt, "id" | "verified" | "httpStatus" | "duplicate" | "outcome"> => ({
    webhookId: h["webhook-id"],
    receivedAt: now,
    bodyBytes: input.body.length,
    headers: redactHeaders(Object.fromEntries(["ucp-agent", "webhook-id", "webhook-timestamp", "content-digest", "signature-input", "signature"].filter((k) => h[k]).map((k) => [k, h[k]!]))),
    webhookTimestamp: Number(h["webhook-timestamp"]) || undefined,
  });
  const record = async (r: WebhookReceipt) => {
    await store.set(receiptKey(platformId, r.id), r);
    await store.listPush(receiptIndex(platformId), r.id, { max: 300 });
  };
  const reject = async (status: number, reason: string, detail: string, extra: Partial<WebhookReceipt> = {}): Promise<WebhookResponse> => {
    await record({ ...base(), id: `rej_${randomUUID().slice(0, 8)}`, verified: false, httpStatus: status, duplicate: false, outcome: "rejected", reason, detail, ...extra });
    return { status, body: { ucp: { version: UCP_VERSION, status: "error" }, messages: [{ type: "error", code: reason, content: detail, severity: "unrecoverable" }] } };
  };

  if (!PLATFORM_ID_RE.test(platformId)) return reject(404, "unknown_platform", "No platform is registered for this webhook URL");
  if (!h["webhook-id"] || !/^[A-Za-z0-9_.:-]{1,128}$/.test(h["webhook-id"]) || !h["webhook-timestamp"]) {
    return reject(400, "webhook_headers_invalid", "Webhook-Id and Webhook-Timestamp are required");
  }
  const agent = parseUcpAgent(h["ucp-agent"]);
  if (!agent.ok) return reject(400, "invalid_profile_url", agent.reason);
  const signerProfileUrl = agent.profile;

  // Resolve the signer's published keys (cached; refetched once if the kid is unknown, to follow key rotation).
  let keys: BusinessKeys;
  try {
    keys = await businessKeys(deps, signerProfileUrl, false);
  } catch (e) {
    const err = e as SafeFetchError;
    const urlProblem = ["invalid_url", "scheme_not_allowed", "userinfo_not_allowed", "not_allowlisted", "blocked_address"].includes(err.code);
    return reject(urlProblem ? 400 : 424, urlProblem ? "invalid_profile_url" : "profile_unreachable", `Signer profile ${urlProblem ? "rejected" : "unavailable"}: ${err.message}`, { signerProfileUrl });
  }
  const verifyWith = (k: BusinessKeys) =>
    verifyRequest({ method: input.method, url: input.url, headers: h, body: input.body, resolveKey: (kid) => k.keys.find((x) => x.kid === kid), requireComponents: ["webhook-id", "webhook-timestamp", "ucp-agent"], nowSec: Math.floor(now / 1000), maxAgeSec: TIMESTAMP_WINDOW_SEC });
  let v = verifyWith(keys);
  if (!v.ok && v.reason === "key_not_found") {
    try {
      v = verifyWith(await businessKeys(deps, signerProfileUrl, true));
    } catch {
      /* keep the original failure */
    }
  }
  if (!v.ok) return reject(VERIFY_HTTP[v.reason], v.reason, v.detail, { signerProfileUrl });

  const ts = Number(h["webhook-timestamp"]);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(now / 1000) - ts) > TIMESTAMP_WINDOW_SEC) {
    return reject(400, "webhook_timestamp_invalid", `Webhook-Timestamp is outside the ±${TIMESTAMP_WINDOW_SEC}s window`, { signerProfileUrl, keyid: v.keyid, alg: v.alg });
  }

  let order: Record<string, unknown>;
  try {
    order = JSON.parse(input.body.toString("utf8")) as Record<string, unknown>;
  } catch {
    return reject(400, "invalid_order_payload", "Body is not valid JSON", { signerProfileUrl, keyid: v.keyid, alg: v.alg });
  }
  const parsed = OrderSchema.safeParse(order);
  if (!parsed.success) {
    const i = issuesOf(parsed.error.issues)[0];
    return reject(422, "invalid_order_payload", `Order failed schema validation at ${i?.path}: ${i?.message}`, { signerProfileUrl, keyid: v.keyid, alg: v.alg });
  }
  const orderId = String(order.id);

  // AUTHORIZATION: a valid signature only proves WHO signed. The signer must also be the business that owns this order.
  const own = await store.get<Ownership>(ownKey(platformId, orderId));
  if (!own) return reject(403, "unknown_order", "This platform has no order with that id", { signerProfileUrl, keyid: v.keyid, alg: v.alg, orderId });
  if (own.businessProfileUrl !== signerProfileUrl) {
    return reject(403, "signer_not_order_business", `Order ${orderId} belongs to ${own.businessProfileUrl}, not to the signer ${signerProfileUrl}`, { signerProfileUrl, keyid: v.keyid, alg: v.alg, orderId });
  }

  // Dedupe (only after authentication + authorization).
  const receipt: WebhookReceipt = { ...base(), id: h["webhook-id"], orderId, signerProfileUrl, keyid: v.keyid, alg: v.alg, verified: true, httpStatus: 200, duplicate: false, outcome: "pending" };
  const first = await store.setNX(seenKey(platformId, h["webhook-id"]), true, { ttlSec: 7 * 24 * 3600 });
  const ack = { ucp: { version: UCP_VERSION } };
  if (!first) {
    await record({ ...receipt, id: `dup_${randomUUID().slice(0, 8)}`, duplicate: true, outcome: "duplicate" });
    return { status: 200, body: ack }; // acknowledge so the sender stops retrying; no side effects
  }
  await record(receipt);

  const process = async () => {
    const sk = snapKey(platformId, orderId);
    await store.withLock(sk, async () => {
      const prev = await store.get<OrderSnapshot>(sk);
      const stale = prev !== null && prev.webhookTs > ts; // last-write-wins by Webhook-Timestamp
      const entry = { webhookId: h["webhook-id"]!, ts, receivedAt: now, applied: !stale };
      const next: OrderSnapshot = stale ? { ...prev!, history: [...prev!.history, entry] } : { order, webhookId: h["webhook-id"]!, webhookTs: ts, receivedAt: now, history: [...(prev?.history ?? []), entry] };
      await store.set(sk, next, { ttlSec: 24 * 3600 });
      if (!prev) await store.listPush(snapIndex(platformId), orderId, { max: 200 });
      await store.set(receiptKey(platformId, receipt.id), { ...receipt, outcome: stale ? "stale_ignored" : "applied" } satisfies WebhookReceipt);
    });
  };
  return { status: 200, body: ack, process };
}

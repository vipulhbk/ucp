import "server-only";
import { randomUUID } from "node:crypto";
import { getConfig } from "@/config";
import { redactBody, redactHeaders } from "@/observability/redact";
import { Recorder, type InteractionRecord } from "@/observability/recorder";
import { getStore } from "@/persistence";
import { UCP_VERSION } from "@/ucp/constants";
import { safeFetch } from "@/ucp/safe-fetch";
import { demoOrigins } from "@/platform/origins";
import { resolveOrigin } from "@/config";
import { SAFE_REPLAY_OPS, isReplayable } from "@/lib/inspector-shared";
import { getPlatform, mergedLog } from "./platform-session";
import type { SessionContext } from "./session";

export interface InspectorFilter {
  actor?: string[];
  op?: string[];
  q?: string;
  /** ok = 2xx/3xx · client_error = 4xx · server_error = 5xx · no_response = transport failure · invalid = any schema validation failed */
  status?: "ok" | "client_error" | "server_error" | "no_response" | "invalid";
  correlationId?: string;
  limit?: number;
}

const STATUSES = new Set(["ok", "client_error", "server_error", "no_response", "invalid"]);

export function filterFromQuery(q: URLSearchParams): InspectorFilter {
  const list = (k: string) => q.get(k)?.split(",").map((s) => s.trim()).filter(Boolean);
  const status = q.get("status") ?? undefined;
  const limit = Number(q.get("limit"));
  return {
    actor: list("actor"),
    op: list("op"),
    q: q.get("q")?.slice(0, 200) || undefined,
    status: status && STATUSES.has(status) ? (status as InspectorFilter["status"]) : undefined,
    correlationId: q.get("correlation")?.slice(0, 100) || undefined,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : undefined,
  };
}

export const statusClass = (e: InteractionRecord): NonNullable<InspectorFilter["status"]> | "ok" => {
  if (e.status === undefined) return "no_response";
  if (e.status >= 500) return "server_error";
  if (e.status >= 400) return "client_error";
  return "ok";
};

export function filterEvents(events: InteractionRecord[], f: InspectorFilter): InteractionRecord[] {
  const q = f.q?.toLowerCase();
  const out = events.filter((e) => {
    if (f.actor?.length && !f.actor.includes(e.actor)) return false;
    if (f.op?.length && !f.op.includes(e.op)) return false;
    if (f.correlationId && e.correlationId !== f.correlationId) return false;
    if (f.status === "invalid" && !e.validation.some((v) => !v.ok)) return false;
    if (f.status && f.status !== "invalid" && statusClass(e) !== f.status) return false;
    if (q && !`${e.url} ${e.op} ${e.method} ${e.correlationId} ${e.note ?? ""} ${e.error?.message ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  return f.limit ? out.slice(-f.limit) : out;
}

const count = (xs: string[]) => Object.entries(xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})).map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

/** Facets are computed over the UNFILTERED log so the filter controls always show what exists. */
export function facets(events: InteractionRecord[]) {
  return { actors: count(events.map((e) => e.actor)), ops: count(events.map((e) => e.op)) };
}

export function summarize(events: InteractionRecord[]) {
  const timed = events.filter((e) => e.durationMs !== undefined);
  return {
    total: events.length,
    failures: events.filter((e) => statusClass(e) !== "ok").length,
    validationFailures: events.filter((e) => e.validation.some((v) => !v.ok)).length,
    avgDurationMs: timed.length ? Math.round(timed.reduce((a, e) => a + (e.durationMs ?? 0), 0) / timed.length) : 0,
    correlated: new Set(events.map((e) => e.correlationId)).size,
  };
}

export async function inspect(ctx: SessionContext, filter: InspectorFilter) {
  const all = await mergedLog(ctx.sid);
  return { events: filterEvents(all, filter), facets: facets(all), summary: summarize(all) };
}

/**
 * NDJSON export. Records are redacted when written; they are redacted AGAIN here (defense in depth) and carry no session id.
 * First line is metadata, then one interaction per line.
 */
export function toNdjson(events: InteractionRecord[], now = new Date()): string {
  const meta = { type: "meta", exportedAt: now.toISOString(), ucpVersion: UCP_VERSION, count: events.length, note: "Redacted: credentials, tokens, card data and personal data are removed or masked. Simulated payments only." };
  const lines = events.map((e) => ({
    type: "interaction",
    ...e,
    requestHeaders: redactHeaders(e.requestHeaders),
    requestBody: e.requestBody === undefined ? undefined : redactBody(e.requestBody),
    responseHeaders: e.responseHeaders ? redactHeaders(e.responseHeaders) : undefined,
    responseBody: e.responseBody === undefined ? undefined : redactBody(e.responseBody),
  }));
  return [meta, ...lines].map((l) => JSON.stringify(l)).join("\n") + "\n";
}

/* ───────────── replay ───────────── */

export type ReplayOutcome =
  | { ok: true; replayed: InteractionRecord; original: { status?: number }; identical: boolean; differences: string[] }
  | { ok: false; status: 404 | 409; kind: "not_found" | "not_replayable"; message: string };

const lastSegment = (url: string) => decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "");

function diffKeys(a: unknown, b: unknown, prefix = "$", out: string[] = []): string[] {
  if (out.length >= 12) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffKeys((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${prefix}.${k}`, out);
  } else out.push(prefix);
  return out;
}

export async function replay(req: Request, ctx: SessionContext, id: string): Promise<ReplayOutcome> {
  const log = await mergedLog(ctx.sid);
  const rec = log.find((e) => e.id === id);
  if (!rec) return { ok: false, status: 404, kind: "not_found", message: "No such interaction in this session." };
  if (!isReplayable(rec.actor, rec.op)) {
    return { ok: false, status: 409, kind: "not_replayable", message: `${rec.actor}:${rec.op} is not replayable from the log. Only read-only platform requests (${SAFE_REPLAY_OPS.join(", ")}) are; a redacted log cannot faithfully reproduce state-changing calls. Use the Checkout Playground to repeat those with the same Idempotency-Key.` };
  }
  const note = `Replay of ${rec.id.slice(0, 8)}`;
  let replayed: InteractionRecord;
  let liveBody: unknown;

  if (rec.op === "get_profile") {
    const cfg = getConfig();
    const t0 = Date.now();
    const res = await safeFetch(rec.url, { headers: { "ucp-agent": rec.requestHeaders["ucp-agent"] ?? "" }, allowedOrigins: demoOrigins(resolveOrigin(req)), devLoopbackHosts: cfg.devLoopbackHosts });
    let body: unknown;
    try {
      body = JSON.parse(res.bodyText);
    } catch {
      body = res.bodyText.slice(0, 2000);
    }
    liveBody = body;
    replayed = await new Recorder(getStore()).record({ id: randomUUID(), sid: ctx.sid, correlationId: randomUUID(), ts: new Date(t0).toISOString(), actor: "platform", op: "get_profile", method: "GET", url: rec.url, requestHeaders: { ...rec.requestHeaders }, status: res.status, responseHeaders: res.headers, responseBody: body, durationMs: res.durationMs, validation: [], note, replayable: true });
  } else {
    const s = await getPlatform(req, ctx);
    if (!s.client) return { ok: false, status: 409, kind: "not_replayable", message: "Discovery has not succeeded for the current platform, so there is no client to replay with." };
    const r = rec.op === "get_checkout" || rec.op === "get_order" ? await s.client.call(rec.op, { id: lastSegment(rec.url) }, { actorNote: note }) : await s.client.call(rec.op as "search_catalog" | "lookup_catalog", { body: rec.requestBody }, { actorNote: note });
    replayed = r.exchange;
    liveBody = r.body;
  }
  const differences = diffKeys(rec.responseBody, redactBody(liveBody));
  return { ok: true, replayed, original: { status: rec.status }, identical: rec.status === replayed.status && differences.length === 0, differences };
}

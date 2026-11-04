import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { ZodTypeAny } from "zod";
import { getConfig, resolveOrigin } from "@/config";
import { Recorder, merchantLogKey, type ValidationEntry } from "@/observability/recorder";
import { getStore } from "@/persistence";
import { errorBody, httpStatusFor, isNormativeCode } from "@/ucp/errors";
import { CAP, UCP_VERSION } from "@/ucp/constants";
import { defer } from "@/lib/defer";
import { type OperationFamily } from "@/ucp/negotiation";
import { verifyApiKey } from "@/ucp/platform-credential";
import { ErrorResponseSchema } from "@/ucp/schemas";
import { issuesOf, toJsonPath } from "@/ucp/validate";
import type { MerchantCtx, ServiceResult } from "./checkout/types";
import { negotiateRequest } from "./negotiate-request";
import { businessProfileFor } from "./profile";

const MAX_BODY_BYTES = 64 * 1024;
const rateLimitPerMin = () => Number(process.env.UCP_RATE_LIMIT_PER_MIN ?? 300);

export interface RouteSpec {
  /** UCP operation name, as in the OpenAPI operationId (e.g. create_checkout). */
  op: string;
  family: OperationFamily | "cart";
  /** Capability that must be in the negotiated intersection for this operation. */
  requires: string;
  auth: "none" | "api_key";
  /** Requires and honors the Idempotency-Key header. */
  idempotent?: boolean;
  /** Validates the request body (official SDK schema). */
  requestSchema?: ZodTypeAny;
  /** Validates the business's own success response (official SDK schema). */
  responseSchema?: ZodTypeAny;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });
}

export type Runner = (ctx: MerchantCtx, body: unknown) => Promise<ServiceResult> | ServiceResult;

/** Shared pipeline for every UCP business endpoint. */
export async function handleUcp(req: Request, spec: RouteSpec, run: Runner): Promise<Response> {
  const started = Date.now();
  const store = getStore();
  const cfg = getConfig();
  const origin = resolveOrigin(req);
  const requestId = req.headers.get("request-id") ?? randomUUID();
  const url = new URL(req.url);
  const baseHeaders: Record<string, string> = { "request-id": requestId };
  const business = businessProfileFor(req);
  let platformId = "public";
  let bodyText = "";
  let bodyJson: unknown;
  const notes: string[] = [];
  const deferred: (() => Promise<unknown>)[] = [];
  if (!req.headers.get("request-id")) notes.push("Request-Id header missing (the OpenAPI marks it required); one was generated");

  const reqHeaders: Record<string, string> = {};
  req.headers.forEach((v, k) => (reqHeaders[k] = v));

  const finish = async (status: number, body: unknown, extra: Record<string, string> = {}, validation: ValidationEntry[] = []): Promise<Response> => {
    const code = (body as { messages?: { code?: string }[] })?.messages?.[0]?.code;
    if (code && (status >= 400 || (body as { ucp?: { status?: string } })?.ucp?.status === "error") && !isNormativeCode(code) && ["unauthorized", "forbidden", "not_found", "idempotency_conflict", "rate_limited", "invalid_request", "internal_error", "invalid_state"].includes(code)) {
      notes.push(`"${code}" is a demo-chosen code (the spec fixes only the HTTP status)`);
    }
    const res = json(status, body, { ...baseHeaders, ...extra });
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (resHeaders[k] = v));
    await new Recorder(store, merchantLogKey).record({
      id: randomUUID(),
      sid: platformId,
      correlationId: requestId,
      ts: new Date(started).toISOString(),
      actor: "business",
      op: spec.op,
      method: req.method,
      url: `${origin}${url.pathname}${url.search}`,
      requestHeaders: reqHeaders,
      requestBody: bodyJson,
      status,
      responseHeaders: resHeaders,
      responseBody: body,
      durationMs: Date.now() - started,
      validation,
      note: notes.join("; ") || undefined,
      replayable: req.method === "GET" || Boolean(req.headers.get("idempotency-key")),
    });
    return res;
  };

  // 1) rate limit (per client address, per minute)
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0]!.trim();
  const bucket = `rl:${createHash("sha256").update(ip).digest("hex").slice(0, 16)}:${Math.floor(Date.now() / 60_000)}`;
  if ((await store.incr(bucket, 70)) > rateLimitPerMin()) {
    return finish(429, errorBody("rate_limited", "Too many requests", { version: UCP_VERSION }), { "retry-after": "30" });
  }

  // 2) body
  if (req.method !== "GET") {
    bodyText = await req.text();
    if (Buffer.byteLength(bodyText) > MAX_BODY_BYTES) return finish(413, errorBody("invalid_request", `Body exceeds ${MAX_BODY_BYTES} bytes`, { version: UCP_VERSION }));
    if (bodyText) {
      try {
        bodyJson = JSON.parse(bodyText);
      } catch {
        return finish(400, errorBody("invalid_request", "Body is not valid JSON", { version: UCP_VERSION }));
      }
    }
  }

  // 3) negotiation (UCP-Agent → platform profile → version → intersection)
  const neg = await negotiateRequest(req, store, business);
  if (!neg.ok) return finish(neg.status, neg.body);
  if (!(spec.requires in neg.active)) {
    return finish(
      httpStatusFor("capabilities_incompatible"),
      errorBody("capabilities_incompatible", `No mutually supported version of ${spec.requires}. Active capabilities: ${Object.keys(neg.active).join(", ") || "none"}.`, {
        version: UCP_VERSION,
        continueUrl: `${origin}/`,
      }),
    );
  }

  // 4) authentication (spec: optional, business policy)
  if (spec.auth === "api_key") {
    const pid = verifyApiKey(cfg.serverSecret, req.headers.get("x-api-key"));
    if (!pid) return finish(401, errorBody("unauthorized", "A valid X-API-Key platform credential is required for this operation", { version: UCP_VERSION }));
    platformId = pid;
  }

  // Open operations (catalog) stay open, but a valid platform credential, if presented, identifies the caller for logging.
  if (spec.auth === "none") {
    const pid = verifyApiKey(cfg.serverSecret, req.headers.get("x-api-key"));
    if (pid) platformId = pid;
  }

  // 5) request validation
  if (spec.requestSchema) {
    const parsed = spec.requestSchema.safeParse(bodyJson ?? {});
    if (!parsed.success) {
      const issues = issuesOf(parsed.error.issues).slice(0, 10);
      const body = {
        ucp: { version: UCP_VERSION, status: "error" as const },
        messages: issues.map((i) => ({ type: "error" as const, code: "invalid_request", severity: "recoverable" as const, path: i.path, content: i.message })),
      };
      return finish(400, body, {}, [{ target: "request", schema: spec.op + " request", ok: false, issues }]);
    }
  }

  const ctx: MerchantCtx = {
    store,
    platformId,
    origin,
    active: neg.active,
    platformProfileUrl: neg.platformProfileUrl,
    handlers: business.ucp.payment_handlers,
    now: Date.now,
    webhookUrl: CAP.order in neg.active ? (neg.platformProfile.ucp.capabilities?.[CAP.order]?.[0]?.config?.webhook_url as string | undefined) : undefined,
    defer: (fn) => deferred.push(fn),
  };

  // 6) execute (with idempotency for state-changing operations)
  const execute = async (): Promise<{ status: number; body: unknown }> => run(ctx, bodyJson);
  let result: { status: number; body: unknown };
  let replay = false;
  if (spec.idempotent) {
    const key = req.headers.get("idempotency-key");
    if (!key || !UUID_RE.test(key)) return finish(400, errorBody("invalid_request", "Idempotency-Key header (UUID) is required for this operation", { version: UCP_VERSION }));
    const reqHash = createHash("sha256").update(`${req.method} ${url.pathname}\n${bodyText}`).digest("hex");
    const idemKey = `m:${platformId}:idem:${key}`;
    const outcome = await store.withLock(idemKey, async () => {
      const prior = await store.get<{ hash: string; status: number; body: unknown }>(idemKey);
      if (prior) return prior.hash === reqHash ? { kind: "replay" as const, prior } : { kind: "conflict" as const };
      const r = await execute();
      if (r.status < 500 && r.status !== 429) await store.set(idemKey, { hash: reqHash, status: r.status, body: r.body }, { ttlSec: 24 * 3600 });
      return { kind: "fresh" as const, r };
    });
    if (outcome.kind === "conflict") return finish(409, errorBody("idempotency_conflict", "This Idempotency-Key was already used with a different request payload", { version: UCP_VERSION }));
    if (outcome.kind === "replay") {
      replay = true;
      result = outcome.prior;
    } else result = outcome.r;
  } else {
    result = await execute();
  }

  // 7) validate our own response (official schema). Strict outside production so drift fails loudly in tests/dev.
  const validation: ValidationEntry[] = [];
  const isError = (result.body as { ucp?: { status?: string } })?.ucp?.status === "error";
  const schema = isError ? ErrorResponseSchema : spec.responseSchema;
  if (schema && !replay) {
    const r = schema.safeParse(result.body);
    const issues = r.success ? [] : r.error.issues.map((i) => ({ path: toJsonPath(i.path), message: i.message }));
    validation.push({ target: "response", schema: `${isError ? "ErrorResponse" : spec.op + " response"}`, ok: r.success, issues });
    if (!r.success) {
      console.error(`[ucp] outbound ${spec.op} response failed schema validation`, JSON.stringify(issues.slice(0, 5)));
      if (!cfg.isProduction) {
        return finish(500, errorBody("internal_error", `Outbound response failed schema validation: ${issues[0]?.path} ${issues[0]?.message}`, { version: UCP_VERSION }), {}, validation);
      }
    }
  }
  if (replay) notes.push("Replayed stored response for a repeated Idempotency-Key");
  const response = await finish(result.status, result.body, replay ? { "idempotent-replayed": "true" } : {}, validation);
  for (const fn of deferred) defer(fn); // webhook delivery runs after the response is on its way
  return response;
}


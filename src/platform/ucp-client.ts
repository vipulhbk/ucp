import { randomUUID } from "node:crypto";
import type { ZodTypeAny } from "zod";
import type { InteractionRecord, Recorder, ValidationEntry } from "@/observability/recorder";
import { safeFetch, SafeFetchError, type SafeFetchOptions } from "@/ucp/safe-fetch";
import {
  CatalogLookupRequestSchema,
  CatalogLookupResponseSchema,
  CatalogSearchRequestSchema,
  CatalogSearchResponseSchema,
  CheckoutCompleteRequestSchema,
  CheckoutCreateRequestSchema,
  CheckoutSchema,
  CheckoutUpdateRequestSchema,
  ErrorResponseSchema,
  OrderSchema,
} from "@/ucp/schemas";
import { serializeUcpAgent } from "@/ucp/ucp-agent";
import { issuesOf } from "@/ucp/validate";

/** One entry per UCP REST operation the platform calls (names/paths from rest.openapi.json). */
export const OPERATIONS = {
  search_catalog: { method: "POST", path: () => "/catalog/search", req: CatalogSearchRequestSchema, res: CatalogSearchResponseSchema, idempotent: false },
  lookup_catalog: { method: "POST", path: () => "/catalog/lookup", req: CatalogLookupRequestSchema, res: CatalogLookupResponseSchema, idempotent: false },
  create_checkout: { method: "POST", path: () => "/checkout-sessions", req: CheckoutCreateRequestSchema, res: CheckoutSchema, idempotent: true },
  get_checkout: { method: "GET", path: (id: string) => `/checkout-sessions/${encodeURIComponent(id)}`, res: CheckoutSchema, idempotent: false },
  update_checkout: { method: "PUT", path: (id: string) => `/checkout-sessions/${encodeURIComponent(id)}`, req: CheckoutUpdateRequestSchema, res: CheckoutSchema, idempotent: true },
  complete_checkout: { method: "POST", path: (id: string) => `/checkout-sessions/${encodeURIComponent(id)}/complete`, req: CheckoutCompleteRequestSchema, res: CheckoutSchema, idempotent: true },
  cancel_checkout: { method: "POST", path: (id: string) => `/checkout-sessions/${encodeURIComponent(id)}/cancel`, res: CheckoutSchema, idempotent: true },
  /** Cart is defined by the spec but not offered by the demo business; used to demonstrate capability negotiation errors. */
  create_cart: { method: "POST", path: () => "/carts", idempotent: true },
  get_order: { method: "GET", path: (id: string) => `/orders/${encodeURIComponent(id)}`, res: OrderSchema, idempotent: false },
} as const;
export type OperationName = keyof typeof OPERATIONS;

export class UcpClientError extends Error {
  constructor(
    public kind: "validation" | "network" | "timeout" | "unsafe_url",
    message: string,
    public issues: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = "UcpClientError";
  }
}

export interface UcpResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  body: T;
  requestId: string;
  idempotencyKey?: string;
  durationMs: number;
  validation: ValidationEntry[];
  /** The redacted interaction as stored for the inspector (what the UI may show). */
  exchange: InteractionRecord;
  attempts: number;
}

export interface UcpClientConfig {
  sid: string;
  /** From discovery: `services["dev.ucp.shopping"][transport=rest].endpoint`. Never hardcoded. */
  endpoint: string;
  platformProfileUrl: string;
  apiKey: string;
  recorder: Recorder;
  fetchOptions: Pick<SafeFetchOptions, "allowedOrigins" | "devLoopbackHosts" | "resolve">;
  /** Vercel Deployment Protection bypass for loopback calls between platform and business on preview deployments. */
  protectionBypassSecret?: string;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called when a checkout response carries an order (bookkeeping for webhook authorization). */
  onOrder?: (o: { orderId: string; checkoutId: string }) => Promise<void> | void;
}

export interface CallOptions {
  /** Reuse a key to retry the *identical* request (lost response). Omit for a genuinely new operation. */
  idempotencyKey?: string;
  /** Send the body as-is (used by the playground to demonstrate server-side validation errors). */
  skipRequestValidation?: boolean;
  actorNote?: string;
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export class UcpClient {
  constructor(private cfg: UcpClientConfig) {}

  /** Generic call: builds spec headers, validates, sends over real HTTP, validates the response, records it. */
  async call<T = unknown>(op: OperationName, args: { id?: string; body?: unknown } = {}, opts: CallOptions = {}): Promise<UcpResponse<T>> {
    const def = OPERATIONS[op];
    const path = (def.path as (id: string) => string)(args.id ?? "");
    const url = `${this.cfg.endpoint}${path}`;
    const requestId = randomUUID();
    const idempotencyKey = def.idempotent ? (opts.idempotencyKey ?? randomUUID()) : undefined;
    const validation: ValidationEntry[] = [];

    if ("req" in def && def.req && !opts.skipRequestValidation) {
      const r = (def.req as ZodTypeAny).safeParse(args.body ?? {});
      if (!r.success) {
        const issues = issuesOf(r.error.issues);
        throw new UcpClientError("validation", `Request failed schema validation: ${issues[0]?.path} ${issues[0]?.message}`, issues);
      }
      validation.push({ target: "request", schema: `${op} request`, ok: true, issues: [] });
    }

    const headers: Record<string, string> = {
      "ucp-agent": serializeUcpAgent(this.cfg.platformProfileUrl),
      "request-id": requestId,
      "x-api-key": this.cfg.apiKey,
      accept: "application/json",
      ...(def.method !== "GET" ? { "content-type": "application/json" } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      ...(this.cfg.protectionBypassSecret ? { "x-vercel-protection-bypass": this.cfg.protectionBypassSecret } : {}),
    };
    const bodyText = def.method !== "GET" ? JSON.stringify(args.body ?? {}) : undefined;
    const started = new Date().toISOString();
    const t0 = Date.now();
    const sleep = this.cfg.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const max = (def.method === "GET" || idempotencyKey) ? (this.cfg.maxRetries ?? 2) : 0; // only retry when it is safe
    let attempts = 0;
    let lastError: SafeFetchError | undefined;

    for (;;) {
      attempts++;
      try {
        const res = await safeFetch(url, { ...this.cfg.fetchOptions, method: def.method, headers, body: bodyText, timeoutMs: this.cfg.timeoutMs ?? 8000 });
        if (RETRYABLE_STATUS.has(res.status) && attempts <= max) {
          const retryAfter = Number(res.headers["retry-after"]);
          await sleep(Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 2000) : 200 * 2 ** (attempts - 1) + Math.random() * 100);
          continue;
        }
        let body: unknown;
        try {
          body = res.bodyText ? JSON.parse(res.bodyText) : undefined;
        } catch {
          body = res.bodyText.slice(0, 2000);
        }
        const isError = (body as { ucp?: { status?: string } } | undefined)?.ucp?.status === "error";
        const resSchema: ZodTypeAny | undefined = isError ? ErrorResponseSchema : (def as { res?: ZodTypeAny }).res;
        if (resSchema && typeof body === "object" && body !== null) {
          const r = resSchema.safeParse(body);
          validation.push({ target: "response", schema: isError ? "ErrorResponse" : `${op} response`, ok: r.success, issues: r.success ? [] : issuesOf(r.error.issues) });
        }
        const placed = (body as { order?: { id?: string }; id?: string } | undefined)?.order?.id;
        if (placed && this.cfg.onOrder && res.status === 200) await this.cfg.onOrder({ orderId: placed, checkoutId: String((body as { id?: string }).id) });
        const exchange = await this.cfg.recorder.record({
          id: randomUUID(),
          sid: this.cfg.sid,
          correlationId: requestId,
          ts: started,
          actor: "platform",
          op,
          method: def.method,
          url,
          requestHeaders: headers,
          requestBody: args.body,
          status: res.status,
          responseHeaders: res.headers,
          responseBody: body,
          durationMs: Date.now() - t0,
          validation,
          replayable: def.method === "GET" || Boolean(idempotencyKey),
          note: [opts.actorNote, attempts > 1 ? `${attempts} attempts` : undefined].filter(Boolean).join("; ") || undefined,
        });
        return { status: res.status, headers: res.headers, body: body as T, requestId, idempotencyKey, durationMs: Date.now() - t0, validation, exchange, attempts };
      } catch (e) {
        lastError = e instanceof SafeFetchError ? e : new SafeFetchError("network", (e as Error).message);
        const transient = lastError.code === "network" || lastError.code === "timeout" || lastError.code === "dns_failure";
        if (transient && attempts <= max) {
          await sleep(200 * 2 ** (attempts - 1) + Math.random() * 100);
          continue;
        }
        await this.cfg.recorder.record({
          id: randomUUID(), sid: this.cfg.sid, correlationId: requestId, ts: started, actor: "platform", op, method: def.method, url,
          requestHeaders: headers, requestBody: args.body, validation, error: { kind: lastError.code, message: lastError.message }, durationMs: Date.now() - t0,
        });
        throw new UcpClientError(lastError.code === "timeout" ? "timeout" : ["not_allowlisted", "blocked_address", "scheme_not_allowed", "invalid_url", "userinfo_not_allowed"].includes(lastError.code) ? "unsafe_url" : "network", lastError.message);
      }
    }
  }

  searchCatalog(body: unknown, o?: CallOptions) {
    return this.call("search_catalog", { body }, o);
  }
  lookupCatalog(body: unknown, o?: CallOptions) {
    return this.call("lookup_catalog", { body }, o);
  }
  createCheckout(body: unknown, o?: CallOptions) {
    return this.call("create_checkout", { body }, o);
  }
  getCheckout(id: string, o?: CallOptions) {
    return this.call("get_checkout", { id }, o);
  }
  updateCheckout(id: string, body: unknown, o?: CallOptions) {
    return this.call("update_checkout", { id, body }, o);
  }
  completeCheckout(id: string, body: unknown, o?: CallOptions) {
    return this.call("complete_checkout", { id, body }, o);
  }
  cancelCheckout(id: string, o?: CallOptions) {
    return this.call("cancel_checkout", { id }, o);
  }
  getOrder(id: string, o?: CallOptions) {
    return this.call("get_order", { id }, o);
  }
}

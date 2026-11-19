import { randomUUID, randomBytes } from "node:crypto";
import * as wellKnown from "@/app/.well-known/ucp/route";
import * as platformProfile from "@/app/api/platform/profile/route";
import * as catalogSearch from "@/app/api/ucp/v1/catalog/search/route";
import * as catalogLookup from "@/app/api/ucp/v1/catalog/lookup/route";
import * as checkoutCreate from "@/app/api/ucp/v1/checkout-sessions/route";
import * as checkoutId from "@/app/api/ucp/v1/checkout-sessions/[id]/route";
import * as checkoutComplete from "@/app/api/ucp/v1/checkout-sessions/[id]/complete/route";
import * as checkoutCancel from "@/app/api/ucp/v1/checkout-sessions/[id]/cancel/route";
import * as orderId from "@/app/api/ucp/v1/orders/[id]/route";
import * as carts from "@/app/api/ucp/v1/carts/route";
import * as tokenizeRoute from "@/app/api/mock-psp/tokenize/route";
import { getConfig } from "@/config";
import { getStore } from "@/persistence";
import { issueApiKey, platformIdFor } from "@/ucp/platform-credential";
import type { PlatformVariant } from "@/platform/profile-variants";
import * as bffDiscovery from "@/app/api/playground/discovery/fetch/route";
import * as bffCall from "@/app/api/playground/ucp/call/route";
import * as bffConsent from "@/app/api/playground/checkout/consent/route";
import * as bffComplete from "@/app/api/playground/checkout/complete/route";
import * as bffAuthorize from "@/app/api/playground/checkout/authorize/route";
import * as agentRoot from "@/app/api/playground/agent/route";
import * as agentMessage from "@/app/api/playground/agent/message/route";
import * as agentProfile from "@/app/api/playground/agent/profile/route";
import * as scnList from "@/app/api/playground/scenarios/route";
import * as scnGet from "@/app/api/playground/scenarios/[id]/route";
import * as scnRun from "@/app/api/playground/scenarios/[id]/run/route";
import * as scnReset from "@/app/api/playground/scenarios/[id]/reset/route";
import * as sessInfo from "@/app/api/playground/session/info/route";
import * as inspEvents from "@/app/api/playground/inspector/events/route";
import * as inspExport from "@/app/api/playground/inspector/export/route";
import * as inspReplay from "@/app/api/playground/inspector/replay/route";
import * as valTargets from "@/app/api/playground/validator/targets/route";
import * as valValidate from "@/app/api/playground/validator/validate/route";
import * as valSchema from "@/app/api/playground/validator/schema/[id]/route";
import * as bffReset from "@/app/api/playground/session/reset/route";
import * as bffTokenize from "@/app/api/playground/payments/tokenize/route";
import * as tripPlan from "@/app/api/playground/trips/plan/route";
import * as tripPlanner from "@/app/api/playground/trips/planner/route";
import * as tripBook from "@/app/api/playground/trips/book/route";
import * as webhookRoute from "@/app/api/platform/webhooks/orders/[platformId]/route";
import * as bffOrders from "@/app/api/playground/orders/route";
import * as bffWebhooks from "@/app/api/playground/webhooks/route";
import * as bffAction from "@/app/api/playground/orders/[id]/action/route";
import * as bffRetry from "@/app/api/playground/webhooks/retry/route";
import * as bffSend from "@/app/api/playground/webhooks/send/route";
import * as cron from "@/app/api/cron/webhooks/route";
import { recordOwnership } from "@/platform/orders";
import { serve } from "./helpers";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

export async function startServer() {
  return serve({
    "/.well-known/ucp": (r) => wellKnown.GET(r),
    "/api/platform/profile": (r) => platformProfile.GET(r),
    "/api/ucp/v1/catalog/search": (r) => catalogSearch.POST(r),
    "/api/ucp/v1/catalog/lookup": (r) => catalogLookup.POST(r),
    "/api/ucp/v1/checkout-sessions": (r) => checkoutCreate.POST(r),
    "/api/ucp/v1/checkout-sessions/:id": (r, p) => (r.method === "GET" ? checkoutId.GET(r, ctx(p.id!) as never) : checkoutId.PUT(r, ctx(p.id!) as never)),
    "/api/ucp/v1/checkout-sessions/:id/complete": (r, p) => checkoutComplete.POST(r, ctx(p.id!) as never),
    "/api/ucp/v1/checkout-sessions/:id/cancel": (r, p) => checkoutCancel.POST(r, ctx(p.id!) as never),
    "/api/ucp/v1/orders/:id": (r, p) => orderId.GET(r, ctx(p.id!) as never),
    "/api/ucp/v1/carts": (r) => carts.POST(r),
    "/api/mock-psp/tokenize": (r) => tokenizeRoute.POST(r),
    "/api/platform/webhooks/orders/:platformId": (r, p) => webhookRoute.POST(r, { params: Promise.resolve({ platformId: p.platformId! }) } as never),
    "/api/playground/orders": (r) => bffOrders.GET(r),
    "/api/playground/webhooks": (r) => bffWebhooks.GET(r),
    "/api/playground/orders/:id/action": (r, p) => bffAction.POST(r, { params: Promise.resolve({ id: p.id! }) } as never),
    "/api/playground/webhooks/retry": (r) => bffRetry.POST(r),
    "/api/playground/webhooks/send": (r) => bffSend.POST(r),
    "/api/cron/webhooks": (r) => cron.GET(r),
    "/api/playground/discovery/fetch": (r) => bffDiscovery.POST(r),
    "/api/playground/ucp/call": (r) => bffCall.POST(r),
    "/api/playground/checkout/consent": (r) => bffConsent.POST(r),
    "/api/playground/checkout/complete": (r) => bffComplete.POST(r),
    "/api/playground/scenarios": (r) => scnList.GET(r),
    "/api/playground/scenarios/:id": (r, p) => scnGet.GET(r, { params: Promise.resolve({ id: p.id! }) } as never),
    "/api/playground/scenarios/:id/run": (r, p) => scnRun.POST(r, { params: Promise.resolve({ id: p.id! }) } as never),
    "/api/playground/scenarios/:id/reset": (r) => scnReset.POST(r),
    "/api/playground/session/info": (r) => sessInfo.GET(r),
    "/api/playground/agent": (r) => agentRoot.GET(r),
    "/api/playground/agent/message": (r) => agentMessage.POST(r),
    "/api/playground/agent/profile": (r) => agentProfile.POST(r),
    "/api/playground/checkout/authorize": (r) => bffAuthorize.POST(r),
    "/api/playground/session/reset": (r) => bffReset.POST(r),
    "/api/playground/inspector/events": (r) => inspEvents.GET(r),
    "/api/playground/inspector/export": (r) => inspExport.GET(r),
    "/api/playground/inspector/replay": (r) => inspReplay.POST(r),
    "/api/playground/validator/targets": () => valTargets.GET(),
    "/api/playground/validator/validate": (r) => valValidate.POST(r),
    "/api/playground/validator/schema/:id": (r, p) => valSchema.GET(r, { params: Promise.resolve({ id: p.id! }) } as never),
    "/api/playground/payments/tokenize": (r) => bffTokenize.POST(r),
    "/api/playground/trips/plan": (r) => tripPlan.POST(r),
    "/api/playground/trips/planner": (r) => tripPlanner.GET(r),
    "/api/playground/trips/book": (r) => tripBook.POST(r),
  });
}

export interface Reply {
  status: number;
  headers: Headers;
  body: any;
  text: string;
}

/** A test platform: a session, a platform profile fixture, and the headers a real platform sends. */
export class TestPlatform {
  readonly sid = randomBytes(16).toString("hex");
  readonly platformId = platformIdFor(this.sid);
  constructor(
    public origin: string,
    public variant: PlatformVariant = "default",
  ) {}

  get profileUrl() {
    return `${this.origin}/api/platform/profile?${this.variant === "default" ? "" : `variant=${this.variant}&`}p=${this.platformId}`;
  }
  get webhookUrl() {
    return `${this.origin}/api/platform/webhooks/orders/${this.platformId}`;
  }
  get businessProfileUrl() {
    return `${this.origin}/.well-known/ucp`;
  }
  /** Platform-side bookkeeping a real platform does when it sees its order (needed to authorize webhooks). */
  async own(orderId: string, checkoutId?: string) {
    await recordOwnership(getStore(), this.platformId, { orderId, checkoutId, businessProfileUrl: this.businessProfileUrl, placedAt: Date.now() });
  }
  get apiKey() {
    return issueApiKey(getConfig().serverSecret, this.platformId);
  }

  headers(extra: Record<string, string | null> = {}, opts: { agent?: boolean; key?: boolean } = {}): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json", "request-id": randomUUID() };
    if (opts.agent !== false) h["ucp-agent"] = `profile="${this.profileUrl}"`;
    if (opts.key !== false) h["x-api-key"] = this.apiKey;
    for (const [k, v] of Object.entries(extra)) if (v === null) delete h[k.toLowerCase()];
    else h[k.toLowerCase()] = v;
    return h;
  }

  async call(method: string, path: string, body?: unknown, extra: Record<string, string | null> = {}, opts: { agent?: boolean; key?: boolean; idempotent?: boolean } = {}): Promise<Reply> {
    const mutating = method !== "GET";
    const headers = this.headers({ ...(mutating && opts.idempotent !== false ? { "idempotency-key": randomUUID() } : {}), ...extra }, opts);
    const res = await fetch(`${this.origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, headers: res.headers, body: json, text };
  }

  create(body: unknown, extra?: Record<string, string | null>) {
    return this.call("POST", "/api/ucp/v1/checkout-sessions", body, extra);
  }
  get(id: string) {
    return this.call("GET", `/api/ucp/v1/checkout-sessions/${id}`);
  }
  update(id: string, body: unknown, extra?: Record<string, string | null>) {
    return this.call("PUT", `/api/ucp/v1/checkout-sessions/${id}`, body, extra);
  }
  async complete(id: string, body: unknown, extra?: Record<string, string | null>) {
    const r = await this.call("POST", `/api/ucp/v1/checkout-sessions/${id}/complete`, body, extra);
    if (r.body?.order?.id) await this.own(r.body.order.id, id); // what the platform client's onOrder hook does in the app
    return r;
  }
  cancel(id: string) {
    return this.call("POST", `/api/ucp/v1/checkout-sessions/${id}/cancel`);
  }
  order(id: string) {
    return this.call("GET", `/api/ucp/v1/orders/${id}`);
  }

  async tokenize(checkoutId: string, number: string, bindingOverride?: { type: string; id: string }): Promise<Reply> {
    const res = await fetch(`${this.origin}/api/mock-psp/tokenize`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey },
      body: JSON.stringify({ credential: { type: "pan", number, expiry_month: 12, expiry_year: 2030, name: "Test Buyer" }, binding: bindingOverride ?? { type: "dev.ucp.shopping.checkout", id: checkoutId } }),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: JSON.parse(text), text };
  }

  /** Create → fill → ready_for_complete. Returns the ready checkout. */
  async readyCheckout(opts: { items?: { id: string; quantity: number }[]; codes?: string[]; option?: "standard" | "express" } = {}) {
    const items = opts.items ?? [{ id: "var_aurora_anc", quantity: 1 }];
    const created = await this.create({ line_items: items.map((i) => ({ item: { id: i.id }, quantity: i.quantity })) });
    if (created.status !== 201) throw new Error(`create failed: ${created.text}`);
    const id = created.body.id as string;
    const updated = await this.update(id, this.fullUpdate(created.body, opts));
    if (updated.status !== 200) throw new Error(`update failed: ${updated.text}`);
    return updated.body;
  }

  /** Builds the complete replacement resource the spec requires on every Update. */
  fullUpdate(current: any, opts: { codes?: string[]; option?: "standard" | "express"; buyer?: object | null; dest?: object | null } = {}) {
    const dest = opts.dest === null ? undefined : (opts.dest ?? { type: "shipping_address", id: "dest_1", street_address: "12 MG Road", address_locality: "Bengaluru", address_region: "KA", postal_code: "560001", address_country: "IN", first_name: "Asha", last_name: "Rao" });
    return {
      line_items: current.line_items.map((l: any) => ({ id: l.id, item: { id: l.item.id }, quantity: l.quantity })),
      ...(opts.buyer === null ? {} : { buyer: opts.buyer ?? { email: "asha@example.com", first_name: "Asha", last_name: "Rao" } }),
      ...(opts.codes ? { discounts: { codes: opts.codes } } : {}),
      ...(dest
        ? {
            fulfillment: {
              methods: [{ id: "method_1", type: "shipping", line_item_ids: current.line_items.map((l: any) => l.id), destinations: [dest], selected_destination_id: (dest as any).id, groups: [{ id: "group_1", selected_option_id: opts.option ?? "standard" }] }],
            },
          }
        : {}),
    };
  }

  completeBody(token: string, handlerId = "mock_tokenizer_1") {
    return { payment: { instruments: [{ id: "instr_1", handler_id: handlerId, type: "card", selected: true, credential: { type: "token", token } }] } };
  }

  /** tokenize + complete for a ready checkout. */
  async pay(checkoutId: string, number = "4242424242424242", extra?: Record<string, string | null>) {
    const tok = await this.tokenize(checkoutId, number);
    if (tok.status !== 200) throw new Error(`tokenize failed: ${tok.text}`);
    return this.complete(checkoutId, this.completeBody(tok.body.token), extra);
  }
}

export const store = () => getStore();

/** A browser-like client for the playground BFF: keeps the demo_sid cookie. */
export class Browser {
  private cookie = "";
  constructor(public origin: string) {}
  async post(path: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${this.origin}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: JSON.stringify(body ?? {}) });
    this.keep(res);
    return { status: res.status, body: await res.json() };
  }
  async get(path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${this.origin}${path}`, { headers: this.cookie ? { cookie: this.cookie } : {} });
    this.keep(res);
    return { status: res.status, body: await res.json() };
  }
  get cookieValue() {
    return this.cookie.split("=")[1] ?? "";
  }
  async getText(path: string): Promise<{ status: number; text: string; headers: Headers }> {
    const res = await fetch(`${this.origin}${path}`, { headers: this.cookie ? { cookie: this.cookie } : {} });
    this.keep(res);
    return { status: res.status, text: await res.text(), headers: res.headers };
  }
  private keep(res: Response) {
    const set = res.headers.getSetCookie?.()[0];
    if (set) this.cookie = set.split(";")[0]!;
  }
  call(op: string, args: { id?: string; body?: unknown; skipValidation?: boolean } = {}) {
    return this.post("/api/playground/ucp/call", { op, ...args });
  }
}

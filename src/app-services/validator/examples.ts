import { MemoryStore } from "@/persistence/memory";
import { catalogSearch } from "@/merchant/catalog/service";
import { renderCheckout } from "@/merchant/checkout/render";
import type { CheckoutRecord, MerchantCtx } from "@/merchant/checkout/types";
import { renderOrder, type OrderRecord } from "@/merchant/orders/orders";
import { CAP, UCP_VERSION } from "@/ucp/constants";
import { demoSigningKey } from "@/ucp/keys";
import { errorBody } from "@/ucp/errors";
import { buildBusinessProfile, buildPlatformProfile, capabilityEntry } from "@/ucp/profile";
import type { CapabilityEntry } from "@/ucp/negotiation";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- examples are free-form JSON mutated by path

export interface Example {
  title: string;
  /** For invalid examples: what is wrong, in plain words. */
  why?: string;
  /** Which layer is expected to catch the problem. Default: the schema. `rule` examples are schema-valid on purpose. */
  breaks?: "schema" | "rule";
  payload: unknown;
}
export interface ExampleSet {
  valid: Example;
  invalid: Example[];
}

const ORIGIN = "https://merchant.example.com";
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Remove or replace a value addressed by a dotted path (numbers index arrays). */
function mutate(obj: unknown, path: string, op: { remove: true } | { set: unknown }): unknown {
  const o = clone(obj) as Json;
  const keys = path.split(".");
  let cur: Json = o;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Json;
  const last = keys.at(-1)!;
  if ("remove" in op) {
    if (Array.isArray(cur)) cur.splice(Number(last), 1);
    else delete cur[last];
  } else cur[last] = op.set;
  return o;
}

function buildAll(): Record<string, ExampleSet> {
  const key = demoSigningKey().publicJwk;
  const business = buildBusinessProfile({ origin: ORIGIN, keys: [key] });
  const platform = buildPlatformProfile({ origin: "https://platform.example.com", webhookUrl: "https://platform.example.com/api/platform/webhooks/orders/0123456789abcdef01234567" });

  const active: Record<string, CapabilityEntry> = Object.fromEntries([CAP.checkout, CAP.fulfillment, CAP.discount].map((n) => [n, capabilityEntry(n)]));
  const now = Date.parse("2026-11-04T10:00:00Z");
  const rec: CheckoutRecord = {
    id: "chk_example0001",
    platformId: "0123456789abcdef01234567",
    lifecycle: "open",
    inputs: {
      lines: [{ id: "li_1", itemId: "var_aurora_anc", quantity: 2 }],
      buyer: { email: "buyer@example.com", first_name: "Asha", last_name: "Rao" },
      codes: ["WELCOME10"],
      shipping: { destinations: [{ id: "dest_1", street_address: "12 MG Road", address_locality: "Bengaluru", address_region: "KA", postal_code: "560001", address_country: "IN" }], selectedDestinationId: "dest_1", selectedOptionId: "standard" },
      instruments: [],
    },
    lineSeq: 1,
    destSeq: 1,
    createdAt: now,
    expiresAt: now + 6 * 3600_000,
    version: 1,
    platformProfileUrl: "https://platform.example.com/api/platform/profile",
  };
  const ctx: MerchantCtx = { store: new MemoryStore(), platformId: rec.platformId, origin: ORIGIN, active, platformProfileUrl: rec.platformProfileUrl, handlers: business.ucp.payment_handlers, now: () => now };
  const rendered = renderCheckout(rec, ctx);
  const checkout = rendered.body;

  const orderRec: OrderRecord = {
    id: "ord_example0001",
    platformId: rec.platformId,
    checkoutId: rec.id,
    platformProfileUrl: rec.platformProfileUrl,
    createdAt: now,
    currency: "INR",
    lines: rendered.pricing.lines.map((l) => ({ id: l.lineId, itemId: l.itemId, title: l.title, unitPrice: l.unitPrice, quantity: l.quantity, totals: l.totals })),
    totals: rendered.pricing.totals,
    destination: { street_address: "12 MG Road", address_locality: "Bengaluru", address_region: "KA", postal_code: "560001", address_country: "IN" },
    shipping: { id: "standard", title: "Standard Delivery", etaDays: [4, 6] },
    shippedQty: {},
    fulfilledQty: {},
    canceledQty: {},
    events: [],
    adjustments: [],
    version: 1,
  };
  const order = renderOrder(orderRec, { origin: ORIGIN, active: {} });

  const createReq = { line_items: [{ item: { id: "var_aurora_anc" }, quantity: 2 }] };
  const updateReq = {
    line_items: [{ id: "li_1", item: { id: "var_aurora_anc" }, quantity: 2 }],
    buyer: { email: "buyer@example.com", first_name: "Asha" },
    fulfillment: { methods: [{ id: "method_1", type: "shipping", line_item_ids: ["li_1"], destinations: [{ type: "shipping_address", id: "dest_1", street_address: "12 MG Road", address_locality: "Bengaluru", address_region: "KA", postal_code: "560001", address_country: "IN" }], selected_destination_id: "dest_1", groups: [{ id: "group_1", selected_option_id: "standard" }] }] },
  };
  const completeReq = { payment: { instruments: [{ id: "instr_1", handler_id: "mock_tokenizer_1", type: "card", selected: true, credential: { type: "token", token: "tok_EXAMPLE_NOT_A_REAL_TOKEN" } }] } };
  const searchReq = { query: "wireless headphones", filters: { price: { max: 500000 } }, pagination: { limit: 10 } };
  const searchRes = catalogSearch({ ...ctx, active: { [CAP.catalogSearch]: capabilityEntry(CAP.catalogSearch) } }, searchReq).body;
  const err = errorBody("out_of_stock", "All requested items are currently out of stock", { continueUrl: `${ORIGIN}/catalog`, version: UCP_VERSION });

  return {
    business_profile: {
      valid: { title: "A valid business profile", payload: business },
      invalid: [
        { title: "payment_handlers missing", why: "`services` and `payment_handlers` MUST be present even when empty.", payload: mutate(business, "ucp.payment_handlers", { remove: true }) },
        { title: "capabilities as an array (older profile shape)", why: "In 2026-08-25, capabilities is a registry keyed by capability name. An array is the pre-2026-08 shape.", payload: mutate(business, "ucp.capabilities", { set: [] }) },
        { title: "version is not a date", why: "The protocol version MUST be a dated release (YYYY-MM-DD), never `draft`.", payload: mutate(business, "ucp.version", { set: "draft" }) },
      ],
    },
    platform_profile: {
      valid: { title: "A valid platform profile", payload: platform },
      invalid: [
        { title: "services is not a registry of arrays", why: "`services[name]` is an array of transport bindings.", payload: mutate(platform, "ucp.services", { set: { "dev.ucp.shopping": { transport: "rest" } } }) },
        { title: "version missing", why: "`ucp.version` is required.", payload: mutate(platform, "ucp.version", { remove: true }) },
      ],
    },
    checkout_create_request: {
      valid: { title: "Two units of one item", payload: createReq },
      invalid: [
        { title: "quantity 0", why: "quantity is an integer step count of at least 1.", payload: mutate(createReq, "line_items.0.quantity", { set: 0 }) },
        { title: "line_items missing", why: "`line_items` is required on create.", payload: {} },
        { title: "item.id is a number", why: "item.id is a string identifier.", payload: mutate(createReq, "line_items.0.item.id", { set: 42 }) },
      ],
    },
    checkout_update_request: {
      valid: { title: "A full replacement with buyer and shipping", payload: updateReq },
      invalid: [
        { title: "line_items omitted", why: "Update is a full replacement; `line_items` is required every time.", payload: mutate(updateReq, "line_items", { remove: true }) },
        { title: "shipping method without line_item_ids", why: "A shipping method in an update names the line items it covers.", payload: mutate(updateReq, "fulfillment.methods.0.line_item_ids", { remove: true }) },
      ],
    },
    checkout_complete_request: {
      valid: { title: "A token credential (no card data)", payload: completeReq },
      invalid: [
        { title: "payment missing", why: "`payment` is required on Complete.", payload: {} },
        { title: "instrument without handler_id", why: "Each instrument names the payment handler instance that produced it.", payload: mutate(completeReq, "payment.instruments.0.handler_id", { remove: true }) },
      ],
    },
    checkout_response: {
      valid: { title: `A ready_for_complete checkout (generated by this project's merchant)`, payload: checkout },
      invalid: [
        { title: "status not in the lifecycle", why: "status is one of incomplete, requires_escalation, ready_for_complete, complete_in_progress, completed, canceled.", payload: mutate(checkout, "status", { set: "pending" }) },
        { title: "totals without a subtotal", why: "totals MUST contain exactly one `subtotal` and one `total`.", payload: mutate(checkout, "totals.0", { remove: true }) },
        { title: "links missing", why: "`links` is required (legal links for the platform to show).", payload: mutate(checkout, "links", { remove: true }) },
        { title: "Schema-valid but breaks a spec rule", breaks: "rule", why: "Passes JSON Schema validation, yet `completed` without `order` violates a lifecycle rule: see the rule checks, which are separate from the schema.", payload: mutate(checkout, "status", { set: "completed" }) },
      ],
    },
    order: {
      valid: { title: "A placed order snapshot", payload: order },
      invalid: [
        { title: "checkout_id missing", why: "An order references the checkout it came from.", payload: mutate(order, "checkout_id", { remove: true }) },
        { title: "line status not in the enum", why: "Line item status is processing, partial, fulfilled or removed.", payload: mutate(order, "line_items.0.status", { set: "shipped" }) },
        { title: "Schema-valid but wrong status derivation", breaks: "rule", why: "Passes the schema, but status `fulfilled` contradicts quantity.fulfilled = 0: see the rule checks.", payload: mutate(order, "line_items.0.status", { set: "fulfilled" }) },
      ],
    },
    catalog_search_request: {
      valid: { title: "Budgeted search", payload: searchReq },
      invalid: [
        { title: "price.max is a string", why: "Amounts are integers in minor units.", payload: mutate(searchReq, "filters.price.max", { set: "5000" }) },
        { title: "pagination.limit 0", why: "limit is an integer of at least 1.", payload: mutate(searchReq, "pagination.limit", { set: 0 }) },
      ],
    },
    catalog_search_response: {
      valid: { title: "A search response (generated by this project's merchant)", payload: searchRes },
      invalid: [{ title: "products missing", why: "`products` is required.", payload: mutate(searchRes, "products", { remove: true }) }],
    },
    error_response: {
      valid: { title: "out_of_stock with a continue_url", payload: err },
      invalid: [
        { title: "messages empty", why: "At least one message is required.", payload: mutate(err, "messages", { set: [] }) },
        { title: "unknown top-level member", why: "The error envelope is closed: only ucp, messages and continue_url are allowed.", payload: { ...err, extra: true } },
        { title: "severity not allowed", why: "severity is recoverable, requires_buyer_input, requires_buyer_review or unrecoverable.", payload: mutate(err, "messages.0.severity", { set: "fatal" }) },
      ],
    },
  };
}

let cache: Record<string, ExampleSet> | undefined;
export const examplesFor = (targetId: string): ExampleSet | undefined => (cache ??= buildAll())[targetId];

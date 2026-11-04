import { CAP, UCP_VERSION } from "@/ucp/constants";
import { errorBody } from "@/ucp/errors";
import { relevantCapabilities } from "@/ucp/negotiation";
import { charge } from "@/sim/psp";
import type { CheckoutCompleteRequest, CheckoutCreateRequest, CheckoutUpdateRequest } from "@/vendor/ucp-sdk/spec_generated";
import { CURRENCY, findVariant } from "../catalog/data";
import { newId } from "../ids";
import { createOrder } from "../orders/orders";
import { CHECKOUT_TTL_MS, MAX_LINE_QUANTITY, renderCheckout, type Message, type Rendered } from "./render";
import { assertTransition, operationAllowed, type CheckoutStatus } from "./state-machine";
import type { BuyerInput, CheckoutInputs, CheckoutRecord, InstrumentInput, MerchantCtx, ServiceResult, ShippingInput } from "./types";
import type { ShippingAddress } from "./fulfillment";

export const checkoutKey = (platformId: string, id: string) => `m:${platformId}:co:${id}`;

const load = (ctx: MerchantCtx, id: string) => ctx.store.get<CheckoutRecord>(checkoutKey(ctx.platformId, id));
const save = (ctx: MerchantCtx, rec: CheckoutRecord) => ctx.store.set(checkoutKey(ctx.platformId, rec.id), rec, { ttlSec: 24 * 3600 });

function errResult(ctx: MerchantCtx, status: number, code: string, content: string, severity: "recoverable" | "unrecoverable" = "unrecoverable"): ServiceResult {
  return { status, body: errorBody(code, content, { severity, continueUrl: `${ctx.origin}/catalog`, capabilities: relevantCapabilities("checkout", ctx.active) }) };
}

const notFound = (ctx: MerchantCtx, id: string) => errResult(ctx, 404, "not_found", `Checkout ${id} was not found`);

interface LineProblem {
  index: number;
  code: "item_unavailable" | "out_of_stock" | "invalid";
  content: string;
}

export function checkLine(itemId: string, quantity: number): Omit<LineProblem, "index"> | null {
  const found = findVariant(itemId);
  if (!found || found.variant.delisted) return { code: "item_unavailable", content: `Item ${itemId} is not available` };
  if (found.variant.stock === 0) return { code: "out_of_stock", content: `${found.product.title} is out of stock` };
  if (quantity > found.variant.stock) return { code: "out_of_stock", content: `Only ${found.variant.stock} of ${found.product.title} available` };
  if (quantity > MAX_LINE_QUANTITY) return { code: "invalid", content: `At most ${MAX_LINE_QUANTITY} per line` };
  return null;
}

function pickBuyer(b: Record<string, unknown> | undefined): BuyerInput | undefined {
  if (!b) return undefined;
  const out: BuyerInput = {};
  for (const k of ["first_name", "last_name", "email", "phone_number"] as const) if (typeof b[k] === "string") out[k] = b[k] as string;
  if (b.consent !== undefined) out.consent = b.consent;
  return Object.keys(out).length ? out : undefined;
}

/** Display-safe: credentials are dropped here and never stored. */
function pickInstruments(payment: { instruments?: unknown[] } | undefined): InstrumentInput[] {
  return (payment?.instruments ?? []).map((raw) => {
    const i = raw as Record<string, unknown>;
    return {
      id: String(i.id),
      handler_id: String(i.handler_id),
      type: String(i.type),
      ...(i.selected !== undefined ? { selected: Boolean(i.selected) } : {}),
      ...(i.display && typeof i.display === "object" ? { display: i.display as Record<string, unknown> } : {}),
      ...(i.billing_address && typeof i.billing_address === "object" ? { billing_address: i.billing_address as Record<string, unknown> } : {}),
    };
  });
}

function parseShipping(body: { fulfillment?: unknown }, destSeq: number): { shipping: ShippingInput; destSeq: number; ignored: boolean } {
  const f = body.fulfillment as { methods?: Record<string, unknown>[] } | undefined;
  const m = f?.methods?.[0];
  if (!m) return { shipping: { destinations: [], selectedDestinationId: null, selectedOptionId: null }, destSeq, ignored: false };
  const ignored = m.type !== undefined && m.type !== "shipping";
  const raw = (m.destinations as Record<string, unknown>[] | undefined) ?? [];
  const destinations: ShippingAddress[] = raw.map((d) => {
    const { type: _t, ...rest } = d;
    void _t;
    return { ...(rest as Omit<ShippingAddress, "id">), id: typeof d.id === "string" && d.id ? d.id : `dest_${++destSeq}` };
  });
  const groups = m.groups as { selected_option_id?: string | null }[] | undefined;
  return {
    shipping: {
      destinations,
      selectedDestinationId: (m.selected_destination_id as string | null | undefined) ?? null,
      selectedOptionId: groups?.[0]?.selected_option_id ?? null,
    },
    destSeq,
    ignored,
  };
}

function inactiveNotes(ctx: MerchantCtx, body: { discounts?: unknown; fulfillment?: unknown }): Message[] {
  const notes: Message[] = [];
  if (body.discounts !== undefined && !(CAP.discount in ctx.active)) notes.push({ type: "info", code: "extension_not_negotiated", path: "$.discounts", content: `${CAP.discount} is not active for this session; discounts were ignored` });
  if (body.fulfillment !== undefined && !(CAP.fulfillment in ctx.active)) notes.push({ type: "info", code: "extension_not_negotiated", path: "$.fulfillment", content: `${CAP.fulfillment} is not active for this session; fulfillment was ignored` });
  return notes;
}

/* ───────────────────────────── create ───────────────────────────── */

export async function createCheckout(ctx: MerchantCtx, body: CheckoutCreateRequest): Promise<ServiceResult> {
  if (body.line_items.length === 0) return errResult(ctx, 200, "invalid", "At least one line item is required");
  // All-or-nothing on create: no resource exists if any line cannot be sold (spec: "no checkout resource is created").
  for (const li of body.line_items) {
    const p = checkLine(li.item.id, li.quantity);
    if (p) return errResult(ctx, 200, p.code, p.content);
  }
  const id = await newId(ctx.store, ctx.platformId, "chk");
  const lines = body.line_items.map((li, i) => ({ id: `li_${i + 1}`, itemId: li.item.id, quantity: li.quantity }));
  let destSeq = 0;
  const fulfillmentActive = CAP.fulfillment in ctx.active;
  const ship = fulfillmentActive ? parseShipping(body, destSeq) : undefined;
  if (ship) destSeq = ship.destSeq;
  const now = ctx.now();
  const rec: CheckoutRecord = {
    id,
    platformId: ctx.platformId,
    lifecycle: "open",
    inputs: {
      lines,
      buyer: pickBuyer(body.buyer as Record<string, unknown> | undefined),
      context: body.context as Record<string, unknown> | undefined,
      codes: CAP.discount in ctx.active ? (body.discounts?.codes ?? []) : [],
      shipping: ship?.shipping,
      instruments: pickInstruments(body.payment),
    },
    lineSeq: lines.length,
    destSeq,
    createdAt: now,
    expiresAt: now + CHECKOUT_TTL_MS,
    version: 1,
    platformProfileUrl: ctx.platformProfileUrl,
  };
  const rendered = renderCheckout(rec, ctx, inactiveNotes(ctx, body));
  await save(ctx, rec);
  return { status: 201, body: rendered.body };
}

/* ───────────────────────────── read ───────────────────────────── */

export async function getCheckout(ctx: MerchantCtx, id: string): Promise<ServiceResult> {
  return ctx.store.withLock(checkoutKey(ctx.platformId, id), async () => {
    let rec = await load(ctx, id);
    if (!rec) return notFound(ctx, id);
    rec = await settle(ctx, rec, true);
    return { status: 200, body: renderCheckout(rec, ctx).body };
  });
}

/** Persist time-driven transitions: expiry, and resolution of asynchronous payment confirmation. */
async function settle(ctx: MerchantCtx, rec: CheckoutRecord, resolveAsync = false): Promise<CheckoutRecord> {
  if (rec.lifecycle === "open" && ctx.now() > rec.expiresAt) {
    assertTransition("incomplete", "canceled");
    rec = { ...rec, lifecycle: "canceled", version: rec.version + 1 };
    await save(ctx, rec);
    return rec;
  }
  if (resolveAsync && rec.lifecycle === "complete_in_progress") {
    // Demo rule: the simulated PSP confirms the async payment when the platform observes it with Get Checkout
    // (spec: only Get Checkout may be used to observe business processing while complete_in_progress).
    const rendered = renderCheckout(rec, ctx);
    const order = await createOrder(ctx, rec, rendered);
    assertTransition("complete_in_progress", "completed");
    rec = { ...rec, lifecycle: "completed", orderId: order.id, pending: undefined, version: rec.version + 1 };
    await save(ctx, rec);
  }
  return rec;
}

/* ───────────────────────────── update (full replacement) ───────────────────────────── */

export async function updateCheckout(ctx: MerchantCtx, id: string, body: CheckoutUpdateRequest): Promise<ServiceResult> {
  return ctx.store.withLock(checkoutKey(ctx.platformId, id), async () => {
    let rec = await load(ctx, id);
    if (!rec) return notFound(ctx, id);
    rec = await settle(ctx, rec);
    const current = renderCheckout(rec, ctx);
    if (!operationAllowed(current.status, "update")) {
      if (current.status === "complete_in_progress") {
        // Spec: leave the checkout unchanged and return it with a recoverable error message.
        return { status: 200, body: renderCheckout(rec, ctx, [{ type: "error", code: "checkout_update_not_allowed", severity: "recoverable", content: "Checkout is complete_in_progress; Update Checkout is not allowed. Use Get Checkout." }]).body };
      }
      return errResult(ctx, 409, "invalid_state", `Checkout is ${current.status} and cannot be updated`);
    }

    const extra: Message[] = inactiveNotes(ctx, body);
    // Full replacement: every omitted field is cleared. Only line items get per-line rejection (previous state kept).
    const prevById = new Map(rec.inputs.lines.map((l) => [l.id, l]));
    const lines: CheckoutInputs["lines"] = [];
    let lineSeq = rec.lineSeq;
    body.line_items.forEach((li, index) => {
      const itemId = li.item.id;
      const prev = li.id ? prevById.get(li.id) : undefined;
      if (li.id && !prev) {
        extra.push({ type: "error", code: "invalid", severity: "recoverable", path: `$.line_items[${index}].id`, content: `Unknown line item id ${li.id}` });
        return;
      }
      const problem = checkLine(itemId, li.quantity);
      if (problem) {
        extra.push({ type: "error", code: problem.code, severity: "recoverable", path: `$.line_items[${index}]${problem.code === "out_of_stock" || problem.code === "invalid" ? ".quantity" : ""}`, content: problem.content });
        if (prev) lines.push(prev); // the line stays at its previous authoritative state
        return;
      }
      lines.push({ id: prev?.id ?? `li_${++lineSeq}`, itemId, quantity: li.quantity });
    });
    if (lines.length === 0) {
      extra.push({ type: "error", code: "missing", severity: "recoverable", path: "$.line_items", content: "At least one valid line item is required; previous line items kept" });
      lines.push(...rec.inputs.lines);
    }

    let destSeq = rec.destSeq;
    const ship = CAP.fulfillment in ctx.active ? parseShipping(body, destSeq) : undefined;
    if (ship) destSeq = ship.destSeq;
    const next: CheckoutRecord = {
      ...rec,
      inputs: {
        lines,
        buyer: pickBuyer(body.buyer as Record<string, unknown> | undefined),
        context: body.context as Record<string, unknown> | undefined,
        codes: CAP.discount in ctx.active ? (body.discounts?.codes ?? []) : [],
        shipping: ship?.shipping,
        instruments: pickInstruments(body.payment),
      },
      lineSeq,
      destSeq,
      paymentFailure: undefined,
      version: rec.version + 1,
    };
    const rendered = renderCheckout(next, ctx, extra);
    assertTransition(current.status, rendered.status);
    await save(ctx, next);
    return { status: 200, body: rendered.body };
  });
}

/* ───────────────────────────── complete ───────────────────────────── */

function failPayment(ctx: MerchantCtx, rec: CheckoutRecord, code: string, content: string): Promise<ServiceResult> {
  const next: CheckoutRecord = { ...rec, paymentFailure: { code, content }, inputs: { ...rec.inputs, instruments: [] }, version: rec.version + 1 };
  const rendered = renderCheckout(next, ctx);
  assertTransition("ready_for_complete", rendered.status);
  return save(ctx, next).then(() => ({ status: 200, body: rendered.body }));
}

export async function completeCheckout(ctx: MerchantCtx, id: string, body: CheckoutCompleteRequest): Promise<ServiceResult> {
  return ctx.store.withLock(checkoutKey(ctx.platformId, id), async () => {
    let rec = await load(ctx, id);
    if (!rec) return notFound(ctx, id);
    rec = await settle(ctx, rec);
    if (body.buyer) rec = { ...rec, inputs: { ...rec.inputs, buyer: { ...rec.inputs.buyer, ...pickBuyer(body.buyer as Record<string, unknown>) } } };
    const before = renderCheckout(rec, ctx);

    if (before.status === "completed" || before.status === "canceled") return errResult(ctx, 409, "invalid_state", `Checkout is ${before.status}; Complete Checkout is not allowed`);
    if (before.status === "complete_in_progress") {
      return { status: 200, body: renderCheckout(rec, ctx, [{ type: "error", code: "checkout_complete_not_allowed", severity: "recoverable", content: "Completion is already in progress. Use Get Checkout." }]).body };
    }
    if (!operationAllowed(before.status, "complete")) {
      return { status: 200, body: renderCheckout(rec, ctx, [{ type: "error", code: "checkout_not_ready", severity: "recoverable", content: `Checkout is ${before.status}; resolve the listed messages first` }]).body };
    }

    const instruments = (body.payment?.instruments ?? []) as Record<string, unknown>[];
    const inst = instruments.find((i) => i.selected === true) ?? instruments[0];
    if (!inst) return failPayment(ctx, rec, "missing", "payment.instruments is required to complete checkout");
    const handlerIds = new Set(Object.values(ctx.handlers).flat().map((h) => h.id));
    if (!handlerIds.has(String(inst.handler_id))) return failPayment(ctx, rec, "payment_handler_unsupported", `Unknown payment handler ${String(inst.handler_id)}; use one advertised in ucp.payment_handlers`);
    if (inst.type !== "card") return failPayment(ctx, rec, "payment_instrument_unsupported", `Instrument type ${String(inst.type)} is not supported by this handler`);
    const cred = inst.credential as { type?: string; token?: string } | undefined;
    if (!cred || cred.type !== "token" || typeof cred.token !== "string") {
      return failPayment(ctx, rec, "invalid_credential_type", "Checkout accepts only a token credential (credential.type=\"token\"). Raw card credentials must never be sent here.");
    }

    const result = await charge(ctx.store, ctx.platformId, { token: cred.token, binding: { type: CAP.checkout, id: rec.id }, amount: before.total, currency: CURRENCY }, ctx.now);
    const kept = pickInstruments({ instruments: [inst] });
    if (result.outcome === "invalid_token") return failPayment(ctx, rec, "payment_failed", `Payment token rejected: ${result.message}`);
    if (result.outcome === "declined" || result.outcome === "insufficient_funds") {
      return failPayment(ctx, rec, "payment_failed", result.message);
    }
    const display = result.display;
    const instrument: InstrumentInput = { ...kept[0]!, selected: true, display: { ...kept[0]?.display, brand: display.brand, last4: display.last4 } };
    if (result.outcome === "async") {
      const next: CheckoutRecord = { ...rec, lifecycle: "complete_in_progress", inputs: { ...rec.inputs, instruments: [instrument] }, pending: { token: cred.token, reference: result.reference }, paymentFailure: undefined, version: rec.version + 1 };
      const rendered = renderCheckout(next, ctx);
      assertTransition("ready_for_complete", rendered.status);
      await save(ctx, next);
      return { status: 200, body: rendered.body };
    }
    const order = await createOrder(ctx, rec, before);
    const next: CheckoutRecord = { ...rec, lifecycle: "completed", orderId: order.id, inputs: { ...rec.inputs, instruments: [instrument] }, paymentFailure: undefined, version: rec.version + 1 };
    const rendered: Rendered = renderCheckout(next, ctx);
    assertTransition("ready_for_complete", rendered.status as CheckoutStatus);
    await save(ctx, next);
    return { status: 200, body: rendered.body };
  });
}

/* ───────────────────────────── cancel ───────────────────────────── */

export async function cancelCheckout(ctx: MerchantCtx, id: string): Promise<ServiceResult> {
  return ctx.store.withLock(checkoutKey(ctx.platformId, id), async () => {
    let rec = await load(ctx, id);
    if (!rec) return notFound(ctx, id);
    rec = await settle(ctx, rec);
    const current = renderCheckout(rec, ctx);
    if (current.status === "completed" || current.status === "canceled") {
      return errResult(ctx, 409, "invalid_state", `Checkout is already ${current.status}; Cancel Checkout is not allowed`);
    }
    assertTransition(current.status, "canceled");
    const next: CheckoutRecord = { ...rec, lifecycle: "canceled", version: rec.version + 1 };
    await save(ctx, next);
    return { status: 200, body: renderCheckout(next, ctx).body };
  });
}

export const CHECKOUT_UCP_VERSION = UCP_VERSION;

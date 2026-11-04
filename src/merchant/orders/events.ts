import type { MerchantCtx } from "../checkout/types";
import { loadOrder, orderKey, publishOrder, type OrderRecord } from "./orders";

/**
 * Business-internal order operations. These are NOT UCP endpoints: release 2026-08-25 defines only Get Order plus
 * webhooks. Fulfillment events and adjustments are how the business records what happened; every change pushes a new
 * full-snapshot webhook.
 *
 * Demo semantics where the spec is open: `fulfilled` counts delivered units; cancellations reduce `quantity.total`
 * (`original` never changes); returns and refunds are adjustments only.
 */
export type AdminAction = "ship" | "deliver" | "cancel" | "return" | "refund";
export const ADMIN_ACTIONS: AdminAction[] = ["ship", "deliver", "cancel", "return", "refund"];

export type ActionOutcome = { ok: true; order: OrderRecord; summary: string } | { ok: false; code: "not_found" | "invalid_state"; message: string };

type Ctx = Pick<MerchantCtx, "store" | "platformId" | "origin" | "now" | "defer">;

const sumQty = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
const orderTotal = (o: OrderRecord) => o.totals.find((t) => t.type === "total")?.amount ?? 0;
const iso = (ctx: Ctx) => new Date(ctx.now()).toISOString();

export async function applyAction(ctx: Ctx, orderId: string, action: AdminAction): Promise<ActionOutcome> {
  return ctx.store.withLock(orderKey(ctx.platformId, orderId), async () => {
    const o = await loadOrder(ctx.store, ctx.platformId, orderId);
    if (!o) return { ok: false, code: "not_found", message: `Order ${orderId} not found` };
    const fail = (message: string): ActionOutcome => ({ ok: false, code: "invalid_state", message });
    const open = o.lines.map((l) => ({ id: l.id, total: l.quantity - (o.canceledQty[l.id] ?? 0) }));
    const canceled = o.adjustments.some((a) => a.type === "cancellation");
    const returned = o.adjustments.some((a) => a.type === "return");
    const refunded = o.adjustments.some((a) => a.type === "refund");
    let summary: string;

    switch (action) {
      case "ship": {
        if (canceled) return fail("The order was canceled");
        const lines = open.map((l) => ({ id: l.id, quantity: l.total - (o.shippedQty[l.id] ?? 0) })).filter((l) => l.quantity > 0);
        if (!lines.length) return fail("Everything has already shipped");
        const n = o.events.length + 1;
        const tracking = `DEMO${o.id.slice(-6).toUpperCase()}${n}`;
        o.events.push({ id: `fev_${n}`, occurred_at: iso(ctx), type: "shipped", line_items: lines, carrier: o.shipping?.title ?? "DemoPost", tracking_number: tracking, tracking_url: `${ctx.origin}/orders/${o.id}#${tracking}`, description: "Handed to the carrier" });
        for (const l of lines) o.shippedQty[l.id] = (o.shippedQty[l.id] ?? 0) + l.quantity;
        summary = "Shipped";
        break;
      }
      case "deliver": {
        const lines = open.map((l) => ({ id: l.id, quantity: (o.shippedQty[l.id] ?? 0) - (o.fulfilledQty[l.id] ?? 0) })).filter((l) => l.quantity > 0);
        if (!lines.length) return fail("Nothing is out for delivery; ship first");
        const n = o.events.length + 1;
        o.events.push({ id: `fev_${n}`, occurred_at: iso(ctx), type: "delivered", line_items: lines, description: "Delivered to the buyer" });
        for (const l of lines) o.fulfilledQty[l.id] = (o.fulfilledQty[l.id] ?? 0) + l.quantity;
        summary = "Delivered";
        break;
      }
      case "cancel": {
        if (canceled) return fail("Already canceled");
        if (sumQty(o.shippedQty) > 0) return fail("Cannot cancel after shipment; wait for delivery and use return");
        for (const l of open) o.canceledQty[l.id] = (o.canceledQty[l.id] ?? 0) + l.total;
        o.adjustments.push({ id: `adj_${o.adjustments.length + 1}`, type: "cancellation", occurred_at: iso(ctx), status: "completed", line_items: open.map((l) => ({ id: l.id, quantity: -l.total })), totals: [{ type: "total", amount: -orderTotal(o) }], description: "Canceled before shipment" });
        summary = "Canceled";
        break;
      }
      case "return": {
        if (canceled || returned) return fail(canceled ? "The order was canceled" : "Already returned");
        const delivered = open.every((l) => (o.fulfilledQty[l.id] ?? 0) === l.total && l.total > 0);
        if (!delivered) return fail("Only a delivered order can be returned");
        o.adjustments.push({ id: `adj_${o.adjustments.length + 1}`, type: "return", occurred_at: iso(ctx), status: "completed", line_items: open.map((l) => ({ id: l.id, quantity: -l.total })), description: "Return received" });
        summary = "Returned";
        break;
      }
      case "refund": {
        if (refunded) return fail("Already refunded");
        if (!canceled && !returned) return fail("Refund requires a cancellation or a return");
        o.adjustments.push({ id: `adj_${o.adjustments.length + 1}`, type: "refund", occurred_at: iso(ctx), status: "completed", totals: [{ type: "total", amount: -orderTotal(o) }], description: "Refunded to the original (simulated) payment method" });
        summary = "Refunded";
        break;
      }
    }
    o.version += 1;
    await ctx.store.set(orderKey(ctx.platformId, orderId), o, { ttlSec: 24 * 3600 });
    await publishOrder(ctx, o, summary);
    return { ok: true, order: o, summary };
  });
}

/** Which admin actions make sense right now (for the console UI). */
export function availableActions(o: OrderRecord): AdminAction[] {
  const canceled = o.adjustments.some((a) => a.type === "cancellation");
  const returned = o.adjustments.some((a) => a.type === "return");
  const refunded = o.adjustments.some((a) => a.type === "refund");
  const open = o.lines.map((l) => l.quantity - (o.canceledQty[l.id] ?? 0));
  const out: AdminAction[] = [];
  if (!canceled && o.lines.some((l, i) => open[i]! - (o.shippedQty[l.id] ?? 0) > 0)) out.push("ship");
  if (o.lines.some((l) => (o.shippedQty[l.id] ?? 0) > (o.fulfilledQty[l.id] ?? 0))) out.push("deliver");
  if (!canceled && sumQty(o.shippedQty) === 0) out.push("cancel");
  if (!canceled && !returned && o.lines.every((l, i) => open[i]! > 0 && (o.fulfilledQty[l.id] ?? 0) === open[i])) out.push("return");
  if ((canceled || returned) && !refunded) out.push("refund");
  return out;
}

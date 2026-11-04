import { CAP, UCP_VERSION } from "@/ucp/constants";
import { relevantCapabilities } from "@/ucp/negotiation";
import type { Store } from "@/persistence/store";
import type { CheckoutRecord, MerchantCtx } from "../checkout/types";
import type { Rendered } from "../checkout/render";
import { newId } from "../ids";
import { orderLabel } from "./label";
import { outboxDeps } from "../webhooks/deps";
import { enqueue, flush } from "../webhooks/outbox";

/** Persisted order. The wire entity is derived from this on every read (full current-state snapshot). */
export interface OrderRecord {
  id: string;
  platformId: string;
  checkoutId: string;
  platformProfileUrl: string;
  createdAt: number;
  currency: string;
  lines: { id: string; itemId: string; title: string; unitPrice: number; quantity: number; totals: { type: string; amount: number; display_text?: string }[] }[];
  totals: { type: string; amount: number; display_text?: string }[];
  destination?: Record<string, unknown>;
  shipping?: { id: string; title: string; etaDays: [number, number] };
  /** The platform's order webhook URL (from its profile) captured when the order was created. */
  webhookUrl?: string;
  shippedQty: Record<string, number>;
  fulfilledQty: Record<string, number>;
  canceledQty: Record<string, number>;
  events: Record<string, unknown>[];
  adjustments: Record<string, unknown>[];
  version: number;
}

export const orderKey = (platformId: string, id: string) => `m:${platformId}:ord:${id}`;
export const orderIndexKey = (platformId: string) => `m:${platformId}:ordidx`;

export async function createOrder(ctx: MerchantCtx, rec: CheckoutRecord, rendered: Rendered): Promise<OrderRecord> {
  const id = await newId(ctx.store, ctx.platformId, "ord");
  const sh = rec.inputs.shipping;
  const dest = sh?.destinations.find((d) => d.id === sh.selectedDestinationId);
  const order: OrderRecord = {
    id,
    platformId: ctx.platformId,
    checkoutId: rec.id,
    platformProfileUrl: rec.platformProfileUrl,
    createdAt: ctx.now(),
    currency: rendered.pricing.currency,
    lines: rendered.pricing.lines.map((l) => ({ id: l.lineId, itemId: l.itemId, title: l.title, unitPrice: l.unitPrice, quantity: l.quantity, totals: l.totals })),
    totals: rendered.pricing.totals,
    ...(dest ? { destination: Object.fromEntries(Object.entries(dest).filter(([k]) => k !== "id")) } : {}),
    ...(rendered.selectedOption ? { shipping: { id: rendered.selectedOption.id, title: rendered.selectedOption.title, etaDays: rendered.selectedOption.etaDays } } : {}),
    webhookUrl: ctx.webhookUrl,
    shippedQty: {},
    fulfilledQty: {},
    canceledQty: {},
    events: [],
    adjustments: [],
    version: 1,
  };
  await ctx.store.set(orderKey(ctx.platformId, id), order, { ttlSec: 24 * 3600 });
  await ctx.store.listPush(orderIndexKey(ctx.platformId), id, { max: 200 });
  await publishOrder(ctx, order, "Order created"); // spec: business MUST send an "Order created" event with the full entity
  return order;
}

export function lineStatus(total: number, fulfilled: number): "removed" | "fulfilled" | "partial" | "processing" {
  if (total === 0) return "removed";
  if (fulfilled === total) return "fulfilled";
  if (fulfilled > 0) return "partial";
  return "processing";
}

/** Wire entity (spec: Order). Always the full current snapshot. */
export function renderOrder(o: OrderRecord, ctx: Pick<MerchantCtx, "origin" | "active">): Record<string, unknown> {
  const eta = o.shipping ? o.shipping.etaDays[1] : 5;
  return {
    ucp: { version: UCP_VERSION, capabilities: relevantCapabilities("order", { [CAP.order]: { version: UCP_VERSION } }) },
    id: o.id,
    label: orderLabel(o.id),
    checkout_id: o.checkoutId,
    permalink_url: `${ctx.origin}/orders/${o.id}`,
    line_items: o.lines.map((l) => ({
      id: l.id,
      item: { id: l.itemId, title: l.title, price: l.unitPrice },
      quantity: { original: l.quantity, total: l.quantity - (o.canceledQty[l.id] ?? 0), fulfilled: o.fulfilledQty[l.id] ?? 0 },
      totals: l.totals,
      status: lineStatus(l.quantity - (o.canceledQty[l.id] ?? 0), o.fulfilledQty[l.id] ?? 0),
    })),
    fulfillment: {
      expectations: o.destination
        ? [
            {
              id: "exp_1",
              line_items: o.lines.map((l) => ({ id: l.id, quantity: l.quantity })),
              method_type: "shipping",
              destination: o.destination,
              description: `${o.shipping?.title ?? "Delivery"} · ${o.shipping ? `${o.shipping.etaDays[0]}–${o.shipping.etaDays[1]} business days` : ""}`.trim(),
              fulfillable_on: new Date(o.createdAt + eta * 86_400_000).toISOString().slice(0, 10),
            },
          ]
        : [],
      events: o.events,
    },
    adjustments: o.adjustments,
    currency: o.currency,
    totals: o.totals,
  };
}

export async function loadOrder(store: Store, platformId: string, id: string): Promise<OrderRecord | null> {
  return store.get<OrderRecord>(orderKey(platformId, id));
}

/**
 * Queue the full current-state snapshot for delivery and schedule delivery after the response.
 * No webhook is queued if the platform advertised no `webhook_url` (it opted out of events).
 */
export async function publishOrder(ctx: Pick<MerchantCtx, "store" | "platformId" | "origin" | "now" | "defer">, order: OrderRecord, summary: string): Promise<void> {
  if (!order.webhookUrl) return;
  const body = JSON.stringify(renderOrder(order, { origin: ctx.origin, active: {} }));
  await enqueue({ store: ctx.store, now: ctx.now }, { platformId: order.platformId, orderId: order.id, orderVersion: order.version, webhookUrl: order.webhookUrl, body, summary });
  const run = () => flush({ ...outboxDeps(ctx.origin), store: ctx.store, now: ctx.now }, order.platformId);
  if (ctx.defer) ctx.defer(run);
}

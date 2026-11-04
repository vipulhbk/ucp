import { CAP, UCP_VERSION } from "@/ucp/constants";
import { relevantCapabilities } from "@/ucp/negotiation";
import { CURRENCY, findVariant } from "../catalog/data";
import { orderLabel } from "../orders/label";
import { priceCheckout, type PricingResult } from "../pricing";
import { addressProblems, shippingOptions, type ShippingOptionDef } from "./fulfillment";
import type { CheckoutStatus } from "./state-machine";
import type { CheckoutRecord, MerchantCtx } from "./types";

export const MAX_LINE_QUANTITY = 10;
/** Orders above this need the buyer to review on the merchant's site (demo trigger for requires_escalation). */
export const HIGH_VALUE_PAISE = 5_000_000;
export const CHECKOUT_TTL_MS = 6 * 60 * 60 * 1000;

export type Severity = "recoverable" | "requires_buyer_input" | "requires_buyer_review" | "unrecoverable";
export interface Message {
  type: "error" | "warning" | "info";
  code: string;
  content: string;
  path?: string;
  severity?: Severity;
}

export interface Rendered {
  status: CheckoutStatus;
  body: Record<string, unknown>;
  pricing: PricingResult;
  selectedOption?: ShippingOptionDef;
  total: number;
}

const has = (ctx: MerchantCtx, cap: string) => cap in ctx.active;

/** Pure function: recompute the full checkout response from stored inputs. Prices come only from the catalog. */
export function renderCheckout(rec: CheckoutRecord, ctx: MerchantCtx, extra: Message[] = []): Rendered {
  const fulfillmentActive = has(ctx, CAP.fulfillment);
  const discountActive = has(ctx, CAP.discount);
  const { inputs } = rec;
  const lineInputs = inputs.lines.map((l) => ({ lineId: l.id, itemId: l.itemId, quantity: l.quantity }));
  const codes = discountActive ? inputs.codes : [];
  const messages: Message[] = [...extra];

  // 1) preliminary pricing to learn the net item value, which drives shipping options
  const pre = priceCheckout({ lines: lineInputs, codes, fulfillmentAmount: 0 });
  const net = pre.subtotal + pre.totals.filter((t) => t.type === "items_discount" || t.type === "discount").reduce((a, t) => a + t.amount, 0);

  // 2) fulfillment
  let fulfillmentBody: Record<string, unknown> | undefined;
  let selectedOption: ShippingOptionDef | undefined;
  if (fulfillmentActive) {
    const sh = inputs.shipping ?? { destinations: [], selectedDestinationId: null, selectedOptionId: null };
    const lineIds = inputs.lines.map((l) => l.id);
    const dests = sh.destinations;
    const selIdx = dests.findIndex((d) => d.id === sh.selectedDestinationId);
    const sel = selIdx >= 0 ? dests[selIdx] : undefined;
    const base = "$.fulfillment.methods[0]";
    if (sh.selectedDestinationId && !sel) {
      messages.push({ type: "error", code: "invalid", severity: "recoverable", path: `${base}.selected_destination_id`, content: `Unknown destination ${sh.selectedDestinationId}` });
    } else if (!sel) {
      messages.push({ type: "error", code: "missing", severity: "recoverable", path: `${base}.selected_destination_id`, content: "Add and select a shipping address" });
    }
    const problems = sel ? addressProblems(sel) : [];
    for (const p of problems) {
      messages.push({ type: "error", code: p.code, severity: "recoverable", path: `${base}.destinations[${selIdx}].${p.path}`, content: p.content });
    }
    const options = sel && problems.length === 0 ? shippingOptions(net) : [];
    selectedOption = options.find((o) => o.id === sh.selectedOptionId);
    if (options.length) {
      if (sh.selectedOptionId && !selectedOption) {
        messages.push({ type: "error", code: "invalid", severity: "recoverable", path: `${base}.groups[0].selected_option_id`, content: `Unknown shipping option ${sh.selectedOptionId}` });
      } else if (!selectedOption) {
        messages.push({ type: "error", code: "missing", severity: "recoverable", path: `${base}.groups[0].selected_option_id`, content: "Choose a shipping option" });
      }
    }
    fulfillmentBody = {
      available_methods: [{ type: "shipping", line_item_ids: lineIds, description: "Delivery within India" }],
      methods: [
        {
          id: "method_1",
          type: "shipping",
          line_item_ids: lineIds,
          destinations: dests.map((d) => ({ type: "shipping_address", ...d })),
          selected_destination_id: sh.selectedDestinationId,
          groups: [
            {
              id: "group_1",
              line_item_ids: lineIds,
              options: options.map((o) => ({
                id: o.id,
                title: o.title,
                description: { plain: o.description },
                carrier: o.carrier,
                totals: [{ type: "total", amount: o.amount }],
              })),
              selected_option_id: selectedOption?.id ?? null,
            },
          ],
        },
      ],
    };
  } else {
    // Physical goods but the platform did not negotiate fulfillment: the API cannot collect shipping.
    messages.push({ type: "error", code: "fulfillment_required", severity: "requires_buyer_input", content: "Shipping details must be entered on the merchant's site. Continue there to finish this purchase." });
  }

  // 3) final pricing (only now is shipping known)
  const pricing = priceCheckout({ lines: lineInputs, codes, fulfillmentAmount: selectedOption?.amount ?? 0 });

  // 4) buyer and discount messages
  const email = inputs.buyer?.email;
  if (!email) messages.push({ type: "error", code: "missing", severity: "recoverable", path: "$.buyer.email", content: "Buyer email is required" });
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) messages.push({ type: "error", code: "invalid", severity: "recoverable", path: "$.buyer.email", content: "Buyer email is not a valid address" });
  for (const r of pricing.rejected) {
    messages.push({ type: "warning", code: r.reason, path: `$.discounts.codes[${r.index}]`, content: r.content });
  }
  if (rec.paymentFailure) {
    messages.push({ type: "error", code: rec.paymentFailure.code, severity: "recoverable", path: "$.payment.instruments[0]", content: rec.paymentFailure.content });
  }
  if (pricing.total > HIGH_VALUE_PAISE) {
    messages.push({ type: "error", code: "high_value_order", severity: "requires_buyer_review", content: `Orders above ₹${HIGH_VALUE_PAISE / 100} need the buyer's review on the merchant's site` });
  }

  // 5) status (derived from content unless a structural lifecycle state applies)
  const expired = rec.lifecycle === "open" && ctx.now() > rec.expiresAt;
  const errs = messages.filter((m) => m.type === "error");
  let status: CheckoutStatus;
  if (rec.lifecycle === "canceled" || expired) status = "canceled";
  else if (rec.lifecycle === "completed") status = "completed";
  else if (rec.lifecycle === "complete_in_progress") status = "complete_in_progress";
  else if (errs.some((m) => m.severity === "requires_buyer_input" || m.severity === "requires_buyer_review")) status = "requires_escalation";
  else if (errs.length > 0) status = "incomplete";
  else status = "ready_for_complete";

  const origin = ctx.origin;
  const body: Record<string, unknown> = {
    ucp: { version: UCP_VERSION, capabilities: relevantCapabilities("checkout", ctx.active), payment_handlers: ctx.handlers },
    id: rec.id,
    status,
    currency: CURRENCY,
    ...(inputs.buyer ? { buyer: inputs.buyer } : {}),
    ...(inputs.context ? { context: inputs.context } : {}),
    line_items: pricing.lines.map((l) => {
      const v = findVariant(l.itemId)!;
      return {
        id: l.lineId,
        item: { id: l.itemId, title: l.title, price: l.unitPrice, image_url: `${origin}${v.product.image}` },
        quantity: l.quantity,
        totals: l.totals,
      };
    }),
    totals: pricing.totals,
    ...(messages.length ? { messages } : {}),
    links: [
      { type: "terms_of_service", url: `${origin}/legal/terms`, title: "Terms of service (demo)" },
      { type: "privacy_policy", url: `${origin}/legal/privacy`, title: "Privacy policy (demo)" },
      { type: "refund_policy", url: `${origin}/legal/refunds`, title: "Refund policy (demo)" },
    ],
    expires_at: new Date(rec.expiresAt).toISOString(),
    continue_url: `${origin}/checkout?continue=${encodeURIComponent(rec.id)}`,
    ...(inputs.instruments.length ? { payment: { instruments: inputs.instruments } } : {}),
    ...(discountActive
      ? {
          discounts: {
            codes: inputs.codes,
            applied: pricing.applied.map((a) => ({ ...(a.code ? { code: a.code } : {}), title: a.title, amount: a.amount, ...(a.automatic ? { automatic: true } : {}), method: a.method, priority: a.priority, allocations: a.allocations })),
          },
        }
      : {}),
    ...(fulfillmentBody ? { fulfillment: fulfillmentBody } : {}),
  };
  if (status === "completed" && rec.orderId) {
    body.order = { id: rec.orderId, label: orderLabel(rec.orderId), permalink_url: `${origin}/orders/${rec.orderId}` };
  }
  return { status, body, pricing, selectedOption, total: pricing.total };
}

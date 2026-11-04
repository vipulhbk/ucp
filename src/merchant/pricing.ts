import { CURRENCY, findVariant } from "./catalog/data";

/**
 * Merchant-authoritative pricing. Nothing here reads a client-supplied price; callers pass only
 * variant ids, quantities, discount codes and a selected shipping option id.
 */
export interface PricedLineInput {
  lineId: string;
  itemId: string;
  quantity: number;
}

export interface Total {
  type: string;
  amount: number;
  display_text?: string;
}

export interface AppliedDiscount {
  code?: string;
  title: string;
  amount: number;
  automatic?: boolean;
  method: "each" | "across";
  priority: number;
  allocations: { path: string; amount: number }[];
}

export interface RejectedCode {
  index: number;
  code: string;
  reason: "discount_code_invalid" | "discount_code_expired" | "discount_code_already_applied" | "discount_code_combination_disallowed";
  content: string;
}

export interface PricedLine {
  lineId: string;
  itemId: string;
  title: string;
  unitPrice: number;
  quantity: number;
  totals: Total[];
}

export interface PricingResult {
  currency: typeof CURRENCY;
  lines: PricedLine[];
  applied: AppliedDiscount[];
  rejected: RejectedCode[];
  totals: Total[];
  subtotal: number;
  total: number;
}

export const TAX_RATE_BPS = 1800; // 18% GST, exclusive, on (subtotal - discounts). Shipping untaxed in this demo.

interface CodeRule {
  title: string;
  kind: "percent_items" | "flat_order";
  value: number; // percent, or paise
  expired?: boolean;
}

export const DISCOUNT_CODES: Record<string, CodeRule> = {
  WELCOME10: { title: "Welcome 10% off", kind: "percent_items", value: 10 },
  FLAT500: { title: "₹500 off your order", kind: "flat_order", value: 50000 },
  SUMMER20: { title: "Summer 20% off", kind: "percent_items", value: 20, expired: true },
};

export const AUTO_DISCOUNT = { title: "5% off orders of ₹15,000+", thresholdPaise: 1_500_000, percent: 5 } as const;

/** Largest-remainder split so allocations always sum exactly to `amount`. */
export function allocateProportionally(amount: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || amount === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / sum);
  const floors = raw.map(Math.floor);
  let rest = amount - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i]! += 1;
    rest -= 1;
  }
  return floors;
}

export interface PriceInput {
  lines: PricedLineInput[];
  codes: string[];
  fulfillmentAmount: number;
}

export function priceCheckout(input: PriceInput): PricingResult {
  const lines: PricedLine[] = input.lines.map((l) => {
    const found = findVariant(l.itemId);
    if (!found) throw new Error(`priceCheckout: unknown item ${l.itemId} (validate before pricing)`);
    const sub = found.variant.price * l.quantity;
    return { lineId: l.lineId, itemId: l.itemId, title: found.product.title, unitPrice: found.variant.price, quantity: l.quantity, totals: [{ type: "subtotal", amount: sub }] };
  });
  const subtotal = lines.reduce((a, l) => a + l.totals[0]!.amount, 0);

  const applied: AppliedDiscount[] = [];
  const rejected: RejectedCode[] = [];
  const seen = new Set<string>();
  let percentApplied = false;
  let flatApplied = false;
  let priority = 0;

  // Per-line running net, so each discount stacks on the previous (priority order).
  const net = lines.map((l) => l.totals[0]!.amount);

  input.codes.forEach((raw, index) => {
    const code = raw.trim().toUpperCase();
    const rule = DISCOUNT_CODES[code];
    if (seen.has(code)) return void rejected.push({ index, code: raw, reason: "discount_code_already_applied", content: `Code '${raw}' is already applied` });
    seen.add(code);
    if (!rule) return void rejected.push({ index, code: raw, reason: "discount_code_invalid", content: `Code '${raw}' was not found` });
    if (rule.expired) return void rejected.push({ index, code: raw, reason: "discount_code_expired", content: `Code '${raw}' has expired` });
    if ((rule.kind === "percent_items" && percentApplied) || (rule.kind === "flat_order" && flatApplied)) {
      return void rejected.push({ index, code: raw, reason: "discount_code_combination_disallowed", content: `Code '${raw}' cannot be combined with another ${rule.kind === "percent_items" ? "percentage" : "flat"} code` });
    }
    priority += 1;
    if (rule.kind === "percent_items") {
      percentApplied = true;
      const per = net.map((n) => Math.floor((n * rule.value) / 100));
      per.forEach((d, i) => {
        net[i]! -= d;
        if (d > 0) lines[i]!.totals.push({ type: "items_discount", amount: -d });
      });
      applied.push({ code: raw, title: rule.title, amount: per.reduce((a, b) => a + b, 0), method: "each", priority, allocations: per.map((d, i) => ({ path: `$.line_items[${i}]`, amount: d })).filter((a) => a.amount > 0) });
    } else {
      flatApplied = true;
      const amount = Math.min(rule.value, net.reduce((a, b) => a + b, 0));
      const alloc = allocateProportionally(amount, net);
      alloc.forEach((d, i) => (net[i]! -= d));
      applied.push({ code: raw, title: rule.title, amount, method: "across", priority, allocations: alloc.map((d, i) => ({ path: `$.line_items[${i}]`, amount: d })).filter((a) => a.amount > 0) });
    }
  });

  // Automatic discount: evaluated on the post-code net; cannot be removed by the platform.
  const netSum = () => net.reduce((a, b) => a + b, 0);
  if (netSum() >= AUTO_DISCOUNT.thresholdPaise) {
    priority += 1;
    const amount = Math.floor((netSum() * AUTO_DISCOUNT.percent) / 100);
    const alloc = allocateProportionally(amount, net);
    alloc.forEach((d, i) => (net[i]! -= d));
    applied.push({ title: AUTO_DISCOUNT.title, amount, automatic: true, method: "across", priority, allocations: alloc.map((d, i) => ({ path: `$.line_items[${i}]`, amount: d })).filter((a) => a.amount > 0) });
  }

  const itemsDiscount = lines.reduce((a, l) => a + l.totals.filter((t) => t.type === "items_discount").reduce((x, t) => x + t.amount, 0), 0);
  const orderDiscount = -applied.filter((d) => d.method === "across").reduce((a, d) => a + d.amount, 0);
  const taxable = netSum();
  const tax = Math.round((taxable * TAX_RATE_BPS) / 10_000);
  const total = subtotal + itemsDiscount + orderDiscount + input.fulfillmentAmount + tax;

  // Line totals end with their net total (after items_discount), as in the spec's line-item example.
  lines.forEach((l, i) => {
    const lineSub = l.totals[0]!.amount;
    const lineItemsDiscount = l.totals.filter((t) => t.type === "items_discount").reduce((a, t) => a + t.amount, 0);
    l.totals.push({ type: "total", amount: lineSub + lineItemsDiscount });
    void i;
  });

  const totals: Total[] = [{ type: "subtotal", display_text: "Subtotal", amount: subtotal }];
  if (itemsDiscount !== 0) totals.push({ type: "items_discount", display_text: "Item discounts", amount: itemsDiscount });
  if (orderDiscount !== 0) totals.push({ type: "discount", display_text: "Order discounts", amount: orderDiscount });
  if (input.fulfillmentAmount > 0) totals.push({ type: "fulfillment", display_text: "Shipping", amount: input.fulfillmentAmount });
  totals.push({ type: "tax", display_text: "GST (18%)", amount: tax });
  totals.push({ type: "total", display_text: "Total", amount: total });

  return { currency: CURRENCY, lines, applied, rejected, totals, subtotal, total };
}

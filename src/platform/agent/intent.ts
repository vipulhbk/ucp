/**
 * Deterministic natural-language understanding for the demo agent. Rules only: no model, no network, no randomness,
 * so the same sentence always yields the same plan. (An LLM could replace this module later; nothing else depends on it.)
 */
export interface ShoppingIntent {
  /** Search text sent to catalog.search, with price phrases removed. */
  query: string;
  maxPaise?: number;
  minPaise?: number;
  /** Product tags the buyer insisted on; the agent verifies them against the returned products. */
  require: string[];
  quantity: number;
  codes: string[];
}

export type Command =
  | { type: "shop"; intent: ShoppingIntent }
  | { type: "affirm" }
  | { type: "select"; index?: number; cheapest?: boolean }
  | { type: "quantity"; quantity: number }
  | { type: "shipping"; option: "standard" | "express" }
  | { type: "apply_code"; code: string }
  | { type: "cancel" }
  | { type: "status" }
  | { type: "help" }
  | { type: "add_to_cart" }
  | { type: "unknown" };

const WORD_NUM: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const ORDINAL: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3 };

const CUR = String.raw`(?:₹|rs\.?|inr)?\s*`;
const AMOUNT = String.raw`([\d][\d,]*(?:\.\d+)?)\s*(k|thousand|lakh|lac)?`;
const MAX_RE = new RegExp(String.raw`\b(?:under|below|less than|up to|upto|within|max(?:imum)?(?: of)?|budget(?: of)?|not more than|at most|cheaper than)\s*${CUR}${AMOUNT}(?:\s*(?:rupees|rs))?`, "i");
const MIN_RE = new RegExp(String.raw`\b(?:over|above|more than|at least|minimum(?: of)?|starting at)\s*${CUR}${AMOUNT}(?:\s*(?:rupees|rs))?`, "i");

function rupeesToPaise(num: string, unit?: string): number {
  let v = Number.parseFloat(num.replace(/,/g, ""));
  const u = unit?.toLowerCase();
  if (u === "k" || u === "thousand") v *= 1000;
  if (u === "lakh" || u === "lac") v *= 100_000;
  return Math.round(v * 100);
}

const FEATURES: [RegExp, string][] = [
  [/\b(noise[- ]?cancel(?:l?ing|lation)?|anc)\b/i, "noise cancellation"],
  [/\b(wireless|bluetooth)\b/i, "wireless"],
  [/\bwired\b/i, "wired"],
];

export function parseShopping(text: string): ShoppingIntent {
  let rest = text;
  let maxPaise: number | undefined;
  let minPaise: number | undefined;
  const max = MAX_RE.exec(rest);
  if (max) {
    maxPaise = rupeesToPaise(max[1]!, max[2]);
    rest = rest.replace(max[0], " ");
  }
  const min = MIN_RE.exec(rest);
  if (min) {
    minPaise = rupeesToPaise(min[1]!, min[2]);
    rest = rest.replace(min[0], " ");
  }
  // a bare "₹5,000" with no qualifier is treated as a budget cap
  const bare = /(?:₹|\brs\.?)\s*([\d][\d,]*(?:\.\d+)?)\s*(k|thousand)?/i.exec(rest);
  if (bare && maxPaise === undefined && minPaise === undefined) {
    maxPaise = rupeesToPaise(bare[1]!, bare[2]);
    rest = rest.replace(bare[0], " ");
  }

  const require = FEATURES.filter(([re]) => re.test(text)).map(([, tag]) => tag);

  let quantity = 1;
  const q = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:x\s*)?(?:pairs?|pcs|pieces?|units?|items?)\b/i.exec(rest) ?? /\bbuy\s+(\d{1,2}|two|three|four|five)\b/i.exec(rest);
  if (q) {
    const raw = q[1]!.toLowerCase();
    quantity = Math.min(Math.max(WORD_NUM[raw] ?? Number.parseInt(raw, 10), 1), 10);
    rest = rest.replace(q[0], " ");
  }

  const codes: string[] = [];
  for (const m of rest.matchAll(/\b(?:code|coupon|promo(?:code)?)\s+([A-Za-z0-9]{4,20})\b/gi)) {
    codes.push(m[1]!.toUpperCase());
    rest = rest.replace(m[0], " ");
  }

  const query = rest
    .replace(/\b(please|can you|could you|i want|i need|i['’]m looking for|looking for|find me|find|show me|show|get me|search for|search|buy me|buy)\b/gi, " ")
    .replace(/[?!.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { query, maxPaise, minPaise, require, quantity, codes };
}

const AFFIRM = /^\s*(yes|yep|yeah|yup|ok(?:ay)?|sure|go ahead|buy(?: it)?|that one|do it|proceed|looks good|sounds good|let'?s do it|take it)\b/i;
const SHOP_VERB = /\b(find|show|search|looking for|look for|want|need|get me|buy|recommend|suggest|any|do you have)\b/i;

export function parseCommand(text: string, ctx: { state: string }): Command {
  const t = text.trim();
  if (!t) return { type: "unknown" };
  if (/\b(cancel|abort|never ?mind|start over|reset|forget it)\b/i.test(t)) return { type: "cancel" };
  if (/\b(help|what can you do|how do(?:es)? this work)\b/i.test(t)) return { type: "help" };
  if (/\b(status|where are we|summary|what['’]?s the total|recap)\b/i.test(t)) return { type: "status" };
  if (/\b(add (?:it |this )?to (?:my |the )?cart|put (?:it )?in (?:my |the )?cart|cart)\b/i.test(t)) return { type: "add_to_cart" };

  const code = /\b(?:code|coupon|promo(?:code)?)\s+([A-Za-z0-9]{4,20})\b/i.exec(t) ?? /\bapply\s+([A-Za-z0-9]{4,20})\b/i.exec(t);
  if (code) return { type: "apply_code", code: code[1]!.toUpperCase() };
  if (/\b(express|faster|fastest|overnight|quick(?:er|est)? (?:shipping|delivery))\b/i.test(t)) return { type: "shipping", option: "express" };
  if (/\b(standard (?:shipping|delivery)|regular (?:shipping|delivery)|cheapest (?:shipping|delivery))\b/i.test(t)) return { type: "shipping", option: "standard" };

  const inCheckout = ["checkout", "awaiting_consent"].includes(ctx.state);
  const qty = /\b(?:quantity|qty|make it|change (?:it )?to|set (?:it )?to|i want|need)\s*(?:to\s*)?(\d{1,2}|one|two|three|four|five)\b/i.exec(t) ?? (inCheckout ? /\b(\d{1,2})\s*(?:units?|pieces?|pcs|pairs?|of them)\b/i.exec(t) : null);
  if (qty && inCheckout) return { type: "quantity", quantity: Math.min(Math.max(WORD_NUM[qty[1]!.toLowerCase()] ?? Number.parseInt(qty[1]!, 10), 1), 10) };

  if (ctx.state === "proposing") {
    if (/\b(cheap(?:est)?|lowest price|least expensive)\b/i.test(t) && !SHOP_VERB.test(t)) return { type: "select", cheapest: true };
    const ord = /\b(first|second|third|1st|2nd|3rd)\b/i.exec(t);
    if (ord) return { type: "select", index: ORDINAL[ord[1]!.toLowerCase()]! - 1 };
    const num = /^\s*(?:#|number |option |no\.? )?([1-3])\s*[.!]?\s*$/i.exec(t);
    if (num) return { type: "select", index: Number.parseInt(num[1]!, 10) - 1 };
  }
  if (AFFIRM.test(t)) return { type: "affirm" };

  const intent = parseShopping(t);
  if (SHOP_VERB.test(t) || intent.maxPaise !== undefined || intent.require.length > 0) return { type: "shop", intent };
  return { type: "unknown" };
}

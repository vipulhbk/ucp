import { createHash, randomUUID } from "node:crypto";
import type { Store } from "@/persistence/store";

/**
 * Buyer authorization (spec: checkout/index.md → Overview: checkout "has to be finalized manually by the user through
 * a trusted UI unless the AP2 Mandates extension is supported"). AP2 is NOT implemented, so this explicit, itemized,
 * single-use consent record is the only path to Complete Checkout.
 *
 * Only the consent BFF route (invoked by the buyer's click) may call `grantConsent`. The agent has no access to it.
 */
export interface ConsentSummary {
  checkoutId: string;
  lineItems: { itemId: string; title: string; quantity: number }[];
  currency: string;
  subtotal: number;
  discounts: number;
  fulfillment: number;
  tax: number;
  total: number;
  shipping?: { optionId: string; title: string; destination?: string };
  paymentMethod: { cardId: string; label: string };
}

export interface ConsentRecord {
  id: string;
  sid: string;
  checkoutId: string;
  grantedAt: number;
  expiresAt: number;
  /** Hash of everything the buyer saw. Complete is refused if the live checkout no longer matches. */
  fingerprint: string;
  summary: ConsentSummary;
  consumed: boolean;
}

export const CONSENT_TTL_MS = 10 * 60 * 1000;
const key = (sid: string, checkoutId: string) => `s:${sid}:consent:${checkoutId}`;

interface CheckoutLike {
  id: string;
  currency: string;
  line_items: { item: { id: string; title: string }; quantity: number }[];
  totals: { type: string; amount: number }[];
  fulfillment?: { methods?: { selected_destination_id?: string | null; destinations?: { id: string; street_address?: string; address_locality?: string; postal_code?: string }[]; groups?: { selected_option_id?: string | null; options?: { id: string; title: string }[] }[] }[] };
}

export function fingerprintOf(c: CheckoutLike, cardId: string): string {
  const canonical = JSON.stringify({
    id: c.id,
    currency: c.currency,
    lines: c.line_items.map((l) => [l.item.id, l.quantity]),
    totals: c.totals.map((t) => [t.type, t.amount]),
    option: c.fulfillment?.methods?.[0]?.groups?.[0]?.selected_option_id ?? null,
    destination: c.fulfillment?.methods?.[0]?.selected_destination_id ?? null,
    card: cardId,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

const sum = (c: CheckoutLike, ...types: string[]) => c.totals.filter((t) => types.includes(t.type)).reduce((a, t) => a + t.amount, 0);

export function summarize(c: CheckoutLike, card: { id: string; label: string }): ConsentSummary {
  const m = c.fulfillment?.methods?.[0];
  const optId = m?.groups?.[0]?.selected_option_id ?? undefined;
  const opt = m?.groups?.[0]?.options?.find((o) => o.id === optId);
  const dest = m?.destinations?.find((d) => d.id === m.selected_destination_id);
  return {
    checkoutId: c.id,
    lineItems: c.line_items.map((l) => ({ itemId: l.item.id, title: l.item.title, quantity: l.quantity })),
    currency: c.currency,
    subtotal: sum(c, "subtotal"),
    discounts: sum(c, "items_discount", "discount"),
    fulfillment: sum(c, "fulfillment"),
    tax: sum(c, "tax"),
    total: sum(c, "total"),
    ...(optId ? { shipping: { optionId: optId, title: opt?.title ?? optId, destination: dest ? [dest.street_address, dest.address_locality, dest.postal_code].filter(Boolean).join(", ") : undefined } } : {}),
    paymentMethod: { cardId: card.id, label: card.label },
  };
}

export async function grantConsent(store: Store, sid: string, checkout: CheckoutLike & { status?: string }, card: { id: string; label: string }, now: () => number = Date.now): Promise<ConsentRecord> {
  if (checkout.status !== "ready_for_complete") throw new ConsentError("not_ready", `Checkout is ${checkout.status}; the buyer can only authorize a ready_for_complete checkout`);
  const rec: ConsentRecord = {
    id: `consent_${randomUUID().slice(0, 8)}`,
    sid,
    checkoutId: checkout.id,
    grantedAt: now(),
    expiresAt: now() + CONSENT_TTL_MS,
    fingerprint: fingerprintOf(checkout, card.id),
    summary: summarize(checkout, card),
    consumed: false,
  };
  await store.set(key(sid, checkout.id), rec, { ttlSec: Math.ceil(CONSENT_TTL_MS / 1000) });
  return rec;
}

export class ConsentError extends Error {
  constructor(
    public code: "missing" | "expired" | "mismatch" | "consumed" | "not_ready",
    message: string,
  ) {
    super(message);
    this.name = "ConsentError";
  }
}

/** Verify that valid, unconsumed consent exists for exactly what the live checkout shows now, then consume it. */
export async function consumeConsent(store: Store, sid: string, live: CheckoutLike, cardId: string, now: () => number = Date.now): Promise<ConsentRecord> {
  const rec = await store.get<ConsentRecord>(key(sid, live.id));
  if (!rec) throw new ConsentError("missing", "The buyer has not authorized this purchase");
  if (rec.consumed) throw new ConsentError("consumed", "This authorization was already used; the buyer must authorize again");
  if (rec.expiresAt <= now()) throw new ConsentError("expired", "The buyer's authorization expired; ask again");
  if (rec.fingerprint !== fingerprintOf(live, cardId)) throw new ConsentError("mismatch", "The checkout or payment method changed after the buyer authorized it; show the buyer the new total and ask again");
  const used = { ...rec, consumed: true };
  await store.set(key(sid, live.id), used, { ttlSec: Math.ceil(CONSENT_TTL_MS / 1000) });
  return used;
}

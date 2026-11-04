import { randomBytes } from "node:crypto";
import type { Store } from "@/persistence/store";

/**
 * SIMULATED credential provider (tokenizer) + PSP. Follows the *pattern* of the spec's Processor Tokenizer
 * handler example; it is not a payment integration. Only published test card numbers are accepted. Anything else —
 * including real, Luhn-valid card numbers — is refused and never stored or logged.
 */
export interface TestCard {
  id: string;
  number: string;
  brand: "visa" | "mastercard";
  outcome: "approved" | "declined" | "insufficient_funds" | "async";
  label: string;
}

export const TEST_CARDS: TestCard[] = [
  { id: "visa_ok", number: "4242424242424242", brand: "visa", outcome: "approved", label: "Visa · always approved" },
  { id: "mc_ok", number: "5555555555554444", brand: "mastercard", outcome: "approved", label: "Mastercard · always approved" },
  { id: "visa_declined", number: "4000000000000002", brand: "visa", outcome: "declined", label: "Visa · always declined" },
  { id: "visa_insufficient", number: "4000000000009995", brand: "visa", outcome: "insufficient_funds", label: "Visa · insufficient funds" },
  { id: "visa_async", number: "4000000000003220", brand: "visa", outcome: "async", label: "Visa · needs asynchronous confirmation" },
];

export const maskedLast4 = (n: string) => n.slice(-4);

export function luhnValid(num: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return num.length >= 12 && sum % 10 === 0;
}

export interface Binding {
  type: string;
  id: string;
}

interface TokenRecord {
  cardId: string;
  outcome: TestCard["outcome"];
  brand: TestCard["brand"];
  last4: string;
  binding: Binding;
  expiresAt: number;
  /** An async-pending or approved charge consumes the token; a decline does not (retry with the same token is allowed). */
  consumed?: boolean;
}

const tokKey = (platformId: string, token: string) => `m:${platformId}:psp:tok:${token}`;
const TOKEN_TTL_SEC = 15 * 60;

export type TokenizeResult =
  | { ok: true; token: string; expiresAt: string; display: { brand: string; last4: string } }
  | { ok: false; status: 422 | 400; code: "non_test_credential" | "unsupported_credential_type" | "invalid_binding"; message: string };

export async function tokenize(
  store: Store,
  platformId: string,
  input: { credential?: { type?: unknown; number?: unknown }; binding?: Partial<Binding> },
  now: () => number = Date.now,
): Promise<TokenizeResult> {
  const b = input.binding;
  if (!b || typeof b.type !== "string" || !b.type || typeof b.id !== "string" || !b.id) {
    return { ok: false, status: 400, code: "invalid_binding", message: "binding.type and a non-empty binding.id are required" };
  }
  const c = input.credential;
  if (!c || c.type !== "pan" || typeof c.number !== "string") {
    return { ok: false, status: 422, code: "unsupported_credential_type", message: 'this simulated handler accepts only credential.type "pan" test cards' };
  }
  const digits = c.number.replace(/[\s-]/g, "");
  const card = TEST_CARDS.find((t) => t.number === digits);
  if (!card) {
    // Deliberately generic: do not echo, store, or hint at the submitted number.
    return { ok: false, status: 422, code: "non_test_credential", message: "SIMULATED handler: only the published test card numbers are accepted. Real card numbers are refused and never stored." };
  }
  const token = `tok_${randomBytes(12).toString("base64url")}`;
  const rec: TokenRecord = { cardId: card.id, outcome: card.outcome, brand: card.brand, last4: maskedLast4(card.number), binding: { type: b.type, id: b.id }, expiresAt: now() + TOKEN_TTL_SEC * 1000 };
  await store.set(tokKey(platformId, token), rec, { ttlSec: TOKEN_TTL_SEC });
  return { ok: true, token, expiresAt: new Date(rec.expiresAt).toISOString(), display: { brand: card.brand, last4: rec.last4 } };
}

export type ChargeResult =
  | { outcome: "approved"; reference: string; display: { brand: string; last4: string } }
  | { outcome: "async"; reference: string; display: { brand: string; last4: string } }
  | { outcome: "declined" | "insufficient_funds"; display: { brand: string; last4: string }; message: string }
  | { outcome: "invalid_token"; message: string };

/** The merchant's PSP port. Re-verifies the binding exactly (spec: binding is a replay guard, exact equality). */
export async function charge(
  store: Store,
  platformId: string,
  input: { token: string; binding: Binding; amount: number; currency: string },
  now: () => number = Date.now,
): Promise<ChargeResult> {
  const rec = await store.get<TokenRecord>(tokKey(platformId, input.token));
  if (!rec || rec.expiresAt <= now()) return { outcome: "invalid_token", message: "token is unknown or expired" };
  if (rec.binding.type !== input.binding.type || rec.binding.id !== input.binding.id) {
    return { outcome: "invalid_token", message: "token is bound to a different resource" };
  }
  if (rec.consumed) return { outcome: "invalid_token", message: "token was already used" };
  const display = { brand: rec.brand, last4: rec.last4 };
  switch (rec.outcome) {
    case "declined":
      return { outcome: "declined", display, message: "The card was declined (simulated)." };
    case "insufficient_funds":
      return { outcome: "insufficient_funds", display, message: "Insufficient funds (simulated)." };
    case "async":
      await store.set(tokKey(platformId, input.token), { ...rec, consumed: true }, { ttlSec: TOKEN_TTL_SEC });
      return { outcome: "async", reference: `psp_${randomBytes(6).toString("hex")}`, display };
    default:
      await store.set(tokKey(platformId, input.token), { ...rec, consumed: true }, { ttlSec: TOKEN_TTL_SEC });
      return { outcome: "approved", reference: `psp_${randomBytes(6).toString("hex")}`, display };
  }
}

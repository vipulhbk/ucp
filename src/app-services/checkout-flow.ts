import "server-only";
import { randomUUID } from "node:crypto";
import { getStore } from "@/persistence";
import { ConsentError, consumeConsent, grantConsent } from "@/platform/consent";
import { tokenizeViaHandler } from "@/platform/tokenize";
import type { CallResult } from "@/lib/api";
import { CAP } from "@/ucp/constants";
import { TEST_CARDS } from "@/sim/psp";
import type { PlatformSession } from "./platform-session";

export class FlowError extends Error {
  constructor(
    public kind: string,
    message: string,
    public status = 409,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "FlowError";
  }
}

interface HandlerEntry {
  id: string;
  config?: { tokenize_url?: string };
}

const cardOf = (cardId: string) => {
  const c = TEST_CARDS.find((x) => x.id === cardId);
  if (!c) throw new FlowError("bad_request", "unknown test card", 400);
  return c;
};
const clientOf = (s: PlatformSession) => {
  if (!s.client) throw new FlowError("discovery_failed", s.report.error?.message ?? "discovery has not succeeded", 409);
  return s.client;
};
const totalOf = (c: { totals?: { type: string; amount: number }[] }) => c.totals?.find((t) => t.type === "total")?.amount;

/**
 * Record the buyer's authorization. `expectedTotal` is the amount the buyer was SHOWN: if the live checkout's total no
 * longer equals it, authorization is refused, so the buyer can only ever authorize what they actually saw.
 */
export async function grantBuyerConsent(session: PlatformSession, args: { checkoutId: string; cardId: string; expectedTotal: number }) {
  const card = cardOf(args.cardId);
  const live = await clientOf(session).getCheckout(args.checkoutId);
  if (live.status !== 200) throw new FlowError("checkout_unavailable", `Get Checkout returned HTTP ${live.status}`, 409, { exchange: live.exchange });
  const total = totalOf(live.body as never);
  if (total !== args.expectedTotal) throw new ConsentError("mismatch", `The total changed from what you were shown (${args.expectedTotal} → ${total}). Review the checkout again before authorizing.`);
  const consent = await grantConsent(getStore(), session.sid, live.body as never, { id: card.id, label: card.label });
  return { consent: { id: consent.id, grantedAt: consent.grantedAt, expiresAt: consent.expiresAt, summary: consent.summary }, checkout: live.body, exchange: live.exchange };
}

export interface CompleteOutcome {
  tokenize: { status: number; body: unknown; exchange: CallResult["exchange"] };
  complete: CallResult | null;
}

/**
 * Complete Checkout, gated by consent: read the live checkout, consume the single-use consent (refused if anything changed),
 * tokenize at the handler the business advertised (simulated), then Complete with a token credential.
 */
export async function completeWithConsent(session: PlatformSession, args: { checkoutId: string; cardId: string; idempotencyKey?: string }): Promise<CompleteOutcome> {
  const card = cardOf(args.cardId);
  const client = clientOf(session);
  const live = await client.getCheckout(args.checkoutId);
  if (live.status !== 200) throw new FlowError("checkout_unavailable", `Get Checkout returned HTTP ${live.status}`, 409, { exchange: live.exchange });
  await consumeConsent(getStore(), session.sid, live.body as never, card.id);

  const handlers = (live.body as { ucp?: { payment_handlers?: Record<string, HandlerEntry[]> } }).ucp?.payment_handlers ?? {};
  const entry = Object.values(handlers).flat()[0];
  const tokenizeUrl = entry?.config?.tokenize_url;
  if (!entry || !tokenizeUrl) throw new FlowError("no_payment_handler", "The business advertised no usable payment handler");

  const tok = await tokenizeViaHandler({ sid: session.sid, recorder: session.recorder, tokenizeUrl, apiKey: session.apiKey, fetchOptions: session.fetchOptions, card: { id: card.id }, binding: { type: CAP.checkout, id: args.checkoutId } });
  const tokenize = { status: tok.status, body: tok.token ? { ...(tok.body as object), token: "[REDACTED]" } : tok.body, exchange: tok.exchange };
  if (!tok.ok || !tok.token) return { tokenize, complete: null };

  const complete = await client.completeCheckout(
    args.checkoutId,
    { payment: { instruments: [{ id: `instr_${randomUUID().slice(0, 8)}`, handler_id: entry.id, type: "card", selected: true, credential: { type: "token", token: tok.token } }] } },
    { idempotencyKey: args.idempotencyKey },
  );
  return { tokenize, complete };
}

/** One buyer click: authorize exactly the shown total, then complete. */
export async function authorizeAndComplete(session: PlatformSession, args: { checkoutId: string; cardId: string; expectedTotal: number; idempotencyKey?: string }) {
  const granted = await grantBuyerConsent(session, args);
  const done = await completeWithConsent(session, args);
  return { consent: granted.consent, consentExchange: granted.exchange, ...done };
}

import { randomUUID } from "node:crypto";
import { rupees } from "@/lib/format";
import type { Store } from "@/persistence/store";
import { TEST_CARDS } from "@/sim/psp";
import { CAP } from "@/ucp/constants";
import type { DiscoveryReport } from "../discovery";
import type { UcpClient, UcpResponse } from "../ucp-client";
import { parseCommand, type ShoppingIntent } from "./intent";
import { emptyRun, type AgentRun, type Candidate, type TimelineEvent, type TimelineKind } from "./types";

/**
 * Rule-based shopping agent. It reaches the business ONLY through the platform's UCP client (the layering lint forbids
 * importing merchant code), discovers capabilities from the profile instead of assuming them, and can never authorize a
 * payment: the buyer's click on the confirmation card is the only path to Complete Checkout.
 */
export interface AgentDeps {
  sid: string;
  store: Store;
  session: () => Promise<{ client?: UcpClient; report: DiscoveryReport }>;
  now?: () => number;
}

export const runKey = (sid: string) => `s:${sid}:agent`;

export async function loadRun(store: Store, sid: string): Promise<AgentRun> {
  return (await store.get<AgentRun>(runKey(sid))) ?? emptyRun(`run_${randomUUID().slice(0, 8)}`);
}
export const saveRun = (store: Store, sid: string, run: AgentRun) => store.set(runKey(sid), run);

/* ───────────── small helpers ───────────── */

interface Msgs {
  type: string;
  code?: string;
  severity?: string;
  path?: string;
  content?: string;
}
export interface CheckoutView {
  id: string;
  status: string;
  currency: string;
  line_items: { id: string; item: { id: string; title: string }; quantity: number }[];
  totals: { type: string; amount: number }[];
  messages?: Msgs[];
  discounts?: { codes?: string[]; applied?: { code?: string; title: string; amount: number; automatic?: boolean }[] };
  fulfillment?: { methods?: { id?: string; selected_destination_id?: string | null; groups?: { selected_option_id?: string | null; options?: { id: string; title: string; totals: { amount: number }[] }[] }[] }[] };
  continue_url?: string;
  order?: { id: string; label?: string };
  ucp?: { capabilities?: Record<string, unknown> };
}

const total = (c: CheckoutView) => c.totals.find((t) => t.type === "total")?.amount ?? 0;
const errorsOf = (c: CheckoutView) => (c.messages ?? []).filter((m) => m.type === "error");
const isErrorBody = (b: unknown) => (b as { ucp?: { status?: string } })?.ucp?.status === "error";
const firstMessage = (b: unknown) => (b as { messages?: Msgs[] })?.messages?.[0];

class Turn {
  constructor(
    private run: AgentRun,
    private now: () => number,
  ) {}
  say(text: string) {
    this.run.transcript.push({ id: randomUUID().slice(0, 8), role: "agent", text, ts: new Date(this.now()).toISOString() });
  }
  log(kind: TimelineKind, title: string, status: TimelineEvent["status"], extra: Partial<TimelineEvent> = {}) {
    this.run.timeline.push({ id: randomUUID().slice(0, 8), ts: new Date(this.now()).toISOString(), kind, title, status, ...extra });
  }
  /** Log a protocol step together with the exchange that proves it. */
  step(kind: TimelineKind, title: string, r: UcpResponse, status: TimelineEvent["status"] = "ok", detail?: string) {
    this.log(kind, title, status, { detail, op: r.exchange.op, correlationId: r.requestId, httpStatus: r.status });
  }
}

/* ───────────── entry points ───────────── */

export async function handleUserMessage(deps: AgentDeps, run: AgentRun, text: string): Promise<void> {
  const now = deps.now ?? Date.now;
  run.transcript.push({ id: randomUUID().slice(0, 8), role: "buyer", text, ts: new Date(now()).toISOString() });
  const t = new Turn(run, now);
  const cmd = parseCommand(text, { state: run.state });

  switch (cmd.type) {
    case "help":
      return t.say("I shop through the merchant's UCP API. Try: “Find me a wireless headphone under ₹5,000 with noise cancellation.” Then pick a result, and I will build the checkout. I can also apply a discount code, change quantity, switch to express shipping, or cancel. I can never pay for you: you authorize the purchase yourself on the confirmation card.");
    case "cancel":
      return cancel(deps, run, t);
    case "status":
      return status(run, t, deps);
    case "add_to_cart":
      return addToCart(deps, run, t);
    case "shop":
      if (run.state === "awaiting_consent" || run.state === "checkout") await cancelQuietly(deps, run, t);
      return startShopping(deps, run, t, cmd.intent);
    case "select":
    case "affirm":
      return onChoose(deps, run, t, cmd.type === "select" ? cmd : undefined);
    case "quantity":
      return adjust(deps, run, t, (r) => void (r.quantity = cmd.quantity), `Changing the quantity to ${cmd.quantity}.`);
    case "shipping":
      return adjust(deps, run, t, (r) => void (r.option = cmd.option), `Switching to ${cmd.option} shipping.`);
    case "apply_code":
      return adjust(deps, run, t, (r) => void (r.codes = [...new Set([...r.codes, cmd.code])]), `Applying code ${cmd.code}.`, cmd.code);
    default:
      return t.say(run.state === "awaiting_consent" ? "Your purchase is ready. I can't authorize it for you: review the confirmation card and click Authorize, or tell me what to change." : "I didn't catch that. Tell me what you'd like to buy, for example “a wireless headphone under ₹5,000 with noise cancellation”. Say “help” for more.");
  }
}

/** The buyer pressed Authorize in the UI. The agent does not trust the claim: it asks the merchant what happened. */
export async function handleAuthorizationResult(deps: AgentDeps, run: AgentRun, cardId?: string): Promise<void> {
  if (cardId) run.lastCardId = cardId;
  const now = deps.now ?? Date.now;
  const t = new Turn(run, now);
  const s = await need(deps, run, t, [CAP.checkout]);
  if (!s || !run.checkoutId) return;
  let r = await s.client.getCheckout(run.checkoutId);
  t.step("complete", "Get Checkout after the buyer's authorization", r);
  let co = r.body as CheckoutView;
  for (let i = 0; i < 3 && co.status === "complete_in_progress"; i++) {
    t.log("info", "The merchant is still processing the payment (complete_in_progress). Polling with Get Checkout.", "info");
    r = await s.client.getCheckout(run.checkoutId);
    t.step("complete", "Get Checkout (polling accepted completion)", r);
    co = r.body as CheckoutView;
  }
  if (co.status === "completed" && co.order) return placed(deps, run, t, s.client, co);
  const failed = errorsOf(co).find((m) => m.code === "payment_failed");
  if (failed) {
    t.log("error", "Payment failed", "error", { detail: failed.content });
    t.say(`The payment didn't go through: ${failed.content} Nothing was charged and no order exists. I'll update the checkout so you can authorize a different card.`);
    const failedCard = run.lastCardId;
    run.pending = undefined;
    await resolveAndPresent(deps, run, t, s.client, co, failedCard);
    return;
  }
  t.log("info", `Checkout is ${co.status}`, "info");
  t.say(`The checkout is currently “${co.status}”. ${co.status === "canceled" ? "It expired or was canceled; tell me what to buy and I'll start again." : "Let me know if you want to change anything."}`);
}

/* ───────────── discovery gate ───────────── */

async function need(deps: AgentDeps, run: AgentRun, t: Turn, caps: string[]) {
  const s = await deps.session();
  const r = s.report;
  if (!s.client || !r.ok) {
    t.log("error", `Discovery failed: ${r.error?.kind ?? "unknown"}`, "error", { detail: r.error?.message, correlationId: r.correlationId, op: "get_profile" });
    t.say(`I can't shop with this merchant: ${r.error?.kind === "version_unsupported" ? "we don't share a UCP protocol version" : (r.error?.message ?? "discovery failed")}. ${r.error?.message ? `(${r.error.message})` : ""}`.trim());
    run.state = "idle";
    return null;
  }
  const active = r.negotiation?.active ?? {};
  const missing = caps.filter((c) => !(c in active));
  if (missing.length) {
    t.log("capability", `Missing capability: ${missing.join(", ")}`, "warn", { detail: "Not in the negotiated intersection, so I will not call it." });
    t.say(`The merchant and I have no mutually supported version of ${missing.join(", ")}, so I can't do that here.`);
    return null;
  }
  return { client: s.client, report: r, active };
}

/* ───────────── shopping ───────────── */

const hasFeature = (tags: string[], req: string) => (req === "wireless" ? tags.includes("wireless") || tags.includes("bluetooth") : tags.includes(req));

async function startShopping(deps: AgentDeps, run: AgentRun, t: Turn, intent: ShoppingIntent): Promise<void> {
  const s = await need(deps, run, t, [CAP.catalogSearch]);
  if (!s) return;
  const act = s.report;
  t.log("discover", "Read the merchant's UCP profile", "ok", {
    detail: `UCP ${act.versionSelection && act.versionSelection.kind !== "unsupported" ? act.versionSelection.version : "?"}; REST endpoint ${act.rest?.endpoint}; ${Object.keys(s.active).length} negotiated capabilities`,
    correlationId: act.correlationId,
    op: "get_profile",
    httpStatus: act.fetch?.status,
  });

  run.require = intent.require;
  run.quantity = intent.quantity;
  run.codes = intent.codes;
  run.query = intent.query;
  run.candidates = [];
  run.selectedIdx = undefined;
  run.checkoutId = undefined;
  run.orderId = undefined;
  run.handoffUrl = undefined;
  run.pending = undefined;

  const body = { query: intent.query, ...(intent.maxPaise !== undefined || intent.minPaise !== undefined ? { filters: { price: { ...(intent.maxPaise !== undefined ? { max: intent.maxPaise } : {}), ...(intent.minPaise !== undefined ? { min: intent.minPaise } : {}) } } } : {}), pagination: { limit: 20 } };
  const r = await s.client.searchCatalog(body);
  if (r.status !== 200 || isErrorBody(r.body)) {
    t.step("search", "Catalog search failed", r, "error", firstMessage(r.body)?.content);
    t.say(`The catalog search failed (${firstMessage(r.body)?.code ?? `HTTP ${r.status}`}). Try again in a moment.`);
    run.state = "idle";
    return;
  }
  type P = { id: string; title: string; price_range: { min: { amount: number } }; media?: { url: string }[]; rating?: { value: number }; tags?: string[]; variants: { id: string; availability?: { available?: boolean } }[] };
  const products = (r.body as { products: P[] }).products;
  const eligible: Candidate[] = [];
  let unavailable = 0;
  let missingFeature = 0;
  for (const p of products) {
    const v = p.variants[0]!;
    const tags = p.tags ?? [];
    if (v.availability?.available === false) {
      unavailable++;
      continue;
    }
    if (!intent.require.every((q) => hasFeature(tags, q))) {
      missingFeature++;
      continue;
    }
    eligible.push({ productId: p.id, variantId: v.id, title: p.title, price: p.price_range.min.amount, rating: p.rating?.value, tags, imageUrl: p.media?.[0]?.url, matches: intent.require });
  }
  eligible.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.price - b.price);
  run.candidates = eligible.slice(0, 3);
  t.step("search", `Searched the catalog for “${intent.query}”`, r, "ok", `${products.length} results; ${eligible.length} satisfy every requirement${missingFeature ? ` (${missingFeature} lacked ${intent.require.join(" + ")})` : ""}${unavailable ? `; ${unavailable} unavailable` : ""}`);

  if (!run.candidates.length) {
    run.state = "idle";
    t.say(`I searched “${intent.query}”${intent.maxPaise !== undefined ? ` up to ${rupees(intent.maxPaise)}` : ""} but nothing satisfies${intent.require.length ? ` “${intent.require.join(" + ")}”` : " that"}. ${missingFeature ? `${missingFeature} result(s) were missing a required feature. ` : ""}Want me to relax the budget or the requirements?`);
    return;
  }
  run.state = "proposing";
  run.pending = { type: "choose_product" };
  const list = run.candidates.map((c, i) => `${i + 1}. ${c.title}: ${rupees(c.price)}${c.rating ? `, rated ${c.rating}` : ""}`).join("\n");
  t.say(`I found ${eligible.length} match${eligible.length === 1 ? "" : "es"}${intent.maxPaise !== undefined ? ` within ${rupees(intent.maxPaise)}` : ""}. Top picks:\n${list}\nMy recommendation is #1 (best rated that meets everything you asked). Say “yes” to start checkout, pick a number, or ask for the cheapest.`);
}

async function onChoose(deps: AgentDeps, run: AgentRun, t: Turn, sel?: { index?: number; cheapest?: boolean }): Promise<void> {
  if (run.state === "awaiting_consent") {
    t.say("Your purchase is ready. I can't authorize it for you: review the confirmation card and click Authorize.");
    return;
  }
  if (run.state !== "proposing" || !run.candidates.length) {
    t.say("Tell me what you'd like to buy first, for example “a wireless headphone under ₹5,000”.");
    return;
  }
  let idx = sel?.index ?? 0;
  if (sel?.cheapest) idx = run.candidates.reduce((best, c, i, a) => (c.price < a[best]!.price ? i : best), 0);
  if (idx < 0 || idx >= run.candidates.length) {
    t.say(`I only have ${run.candidates.length} option(s). Pick a number from 1 to ${run.candidates.length}.`);
    return;
  }
  const c = run.candidates[idx]!;
  run.selectedIdx = idx;
  t.log("select", `Selected ${c.title}`, "ok", { detail: `${rupees(c.price)} · variant ${c.variantId}` });
  await createCheckout(deps, run, t, c);
}

async function createCheckout(deps: AgentDeps, run: AgentRun, t: Turn, c: Candidate): Promise<void> {
  const s = await need(deps, run, t, [CAP.checkout]);
  if (!s) return;
  const r = await s.client.createCheckout({ line_items: [{ item: { id: c.variantId }, quantity: run.quantity }] });
  if (isErrorBody(r.body) || r.status !== 201) {
    const m = firstMessage(r.body);
    t.step("create_checkout", "Create checkout was refused", r, "error", `${m?.code}: ${m?.content}`);
    t.say(`The merchant couldn't create a checkout: ${m?.content ?? `HTTP ${r.status}`}${(r.body as { continue_url?: string }).continue_url ? ` You can browse alternatives at ${(r.body as { continue_url?: string }).continue_url}.` : ""}`);
    run.state = "idle";
    return;
  }
  const co = r.body as CheckoutView;
  run.checkoutId = co.id;
  run.state = "checkout";
  run.pending = undefined;
  t.step("create_checkout", `Created checkout ${co.id}`, r, "ok", `status ${co.status}; the merchant priced it at ${rupees(total(co), co.currency)}`);
  await resolveAndPresent(deps, run, t, s.client, co);
}

/* ───────────── error processing (spec: checkout/index.md → Error Processing Algorithm) ───────────── */

/** Full-replacement body for Update Checkout (the spec requires resending everything to keep). Shared with the scenarios. */
export function buildReplacement(co: CheckoutView, run: Pick<AgentRun, "profile" | "quantity" | "codes" | "option">) {
  const p = run.profile;
  const ids = co.line_items.map((l) => l.id);
  return {
    line_items: co.line_items.map((l) => ({ id: l.id, item: { id: l.item.id }, quantity: run.quantity })),
    buyer: { email: p.email, first_name: p.first_name, last_name: p.last_name },
    ...(co.discounts ? { discounts: { codes: run.codes } } : {}),
    ...(co.fulfillment
      ? {
          fulfillment: {
            methods: [
              {
                id: co.fulfillment.methods?.[0]?.id ?? "method_1",
                type: "shipping",
                line_item_ids: ids,
                destinations: [{ type: "shipping_address", id: "dest_1", street_address: p.street_address, address_locality: p.address_locality, address_region: p.address_region, postal_code: p.postal_code, address_country: p.address_country, first_name: p.first_name, last_name: p.last_name }],
                selected_destination_id: "dest_1",
                groups: [{ id: "group_1", selected_option_id: run.option }],
              },
            ],
          },
        }
      : {}),
  };
}

const updateBody = buildReplacement;

const FIXES: [RegExp, string][] = [
  [/^\$\.buyer\./, "supplied the buyer details from your profile"],
  [/selected_destination_id|destinations\[/, "added your delivery address"],
  [/selected_option_id/, "chose a shipping option"],
];

async function resolveAndPresent(deps: AgentDeps, run: AgentRun, t: Turn, client: UcpClient, start: CheckoutView, failedCardId?: string, forceUpdate = false): Promise<boolean> {
  let co = start;
  let lastSig = "";
  for (let round = 0; round < 4; round++) {
    if (co.status === "ready_for_complete") break;
    if (co.status === "requires_escalation") return handoff(run, t, co);
    if (co.status === "canceled" || co.status === "completed") {
      t.say(`The checkout is ${co.status}.`);
      run.state = "idle";
      return false;
    }
    const errs = errorsOf(co);
    if (errs.some((e) => e.severity === "unrecoverable")) {
      t.say(`The merchant reported a problem I can't fix: ${errs.find((e) => e.severity === "unrecoverable")?.content}`);
      run.state = "idle";
      return false;
    }
    // Recoverable errors that the buyer (not the agent) must resolve: stop and ask.
    const stuck = errs.find((e) => e.code === "address_undeliverable" || (e.code === "out_of_stock" && e.path));
    const sig = JSON.stringify([co.status, errs.map((e) => [e.code, e.path])]);
    // forceUpdate: the buyer may have changed their profile since the last attempt, so try once with the new data.
    if ((stuck && !(forceUpdate && round === 0)) || sig === lastSig) {
      t.log("fix", "Cannot resolve automatically", "warn", { detail: errs.map((e) => `${e.code} ${e.path ?? ""}`).join("; ") });
      t.say(`I need your help: ${errs.map((e) => e.content).join(" ")}${stuck?.code === "address_undeliverable" ? " Update your delivery address in the profile, then say “status”." : ""}`);
      return false;
    }
    lastSig = sig;
    const actions = new Set<string>();
    for (const e of errs) for (const [re, label] of FIXES) if (e.path && re.test(e.path)) actions.add(label);
    const r = await client.updateCheckout(co.id, updateBody(co, run));
    co = r.body as CheckoutView;
    t.step("update_checkout", "Update checkout (full replacement)", r, "ok", `${[...actions].join("; ") || "resent state"} → status ${co.status}`);
    if (actions.size) t.log("fix", `Resolved ${errs.length} recoverable message(s)`, "ok", { detail: [...actions].join("; ") });
  }
  if (co.status === "requires_escalation") return handoff(run, t, co);
  if (co.status !== "ready_for_complete") {
    t.say(`The checkout is “${co.status}” and I couldn't finish it automatically. ${errorsOf(co).map((e) => e.content).join(" ")}`);
    return false;
  }
  present(run, t, co, failedCardId);
  return true;
}

function handoff(run: AgentRun, t: Turn, co: CheckoutView): false {
  const why = errorsOf(co).filter((m) => m.severity?.startsWith("requires_")).map((m) => m.content);
  run.handoffUrl = co.continue_url;
  run.state = "idle";
  run.pending = undefined;
  t.log("handoff", "Handing off to the buyer", "warn", { detail: `${co.continue_url} · ${why.join(" ")}` });
  t.say(`I can't finish this purchase through the API: ${why.join(" ") || "the merchant needs the buyer to continue on its site"}. Please continue at ${co.continue_url}.`);
  return false;
}

function present(run: AgentRun, t: Turn, co: CheckoutView, failedCardId?: string): void {
  const cards = TEST_CARDS.map((c) => ({ id: c.id, label: c.label }));
  const sub = co.totals.find((x) => x.type === "subtotal")?.amount ?? 0;
  const disc = co.totals.filter((x) => x.type === "items_discount" || x.type === "discount").reduce((a, x) => a + x.amount, 0);
  const ship = co.totals.find((x) => x.type === "fulfillment")?.amount ?? 0;
  const tax = co.totals.find((x) => x.type === "tax")?.amount ?? 0;
  const opt = co.fulfillment?.methods?.[0]?.groups?.[0]?.options?.find((o) => o.id === co.fulfillment?.methods?.[0]?.groups?.[0]?.selected_option_id);
  const rejected = (co.messages ?? []).filter((m) => m.type === "warning");
  run.state = "awaiting_consent";
  run.pending = { type: "authorize", checkoutId: co.id, expectedTotal: total(co), currency: co.currency, cards, defaultCardId: cards.find((c) => c.id !== failedCardId)?.id ?? cards[0]!.id, ...(failedCardId ? { failedCardId } : {}) };
  t.log("present", "Checkout is ready_for_complete; presenting payment options", "ok", { detail: `${rupees(total(co), co.currency)} · ${cards.length} simulated payment methods` });
  t.log("await_consent", "Waiting for the buyer's explicit authorization", "info", { detail: "The agent cannot authorize payment; only the buyer's click on the confirmation card can." });
  t.say(
    `Your checkout is ready: ${co.line_items.map((l) => `${l.quantity} × ${l.item.title}`).join(", ")}. Subtotal ${rupees(sub, co.currency)}${disc ? `, discounts ${rupees(disc, co.currency)}` : ""}, shipping ${ship ? rupees(ship, co.currency) : "free"}${opt ? ` (${opt.title})` : ""}, tax ${rupees(tax, co.currency)}. Total ${rupees(total(co), co.currency)}.${rejected.length ? ` Note: ${rejected.map((m) => m.content).join(" ")}` : ""}\nPick a (simulated) payment method and authorize on the confirmation card below. I can't pay for you.`,
  );
}

/* ───────────── adjustments, status, cancel ───────────── */

async function adjust(deps: AgentDeps, run: AgentRun, t: Turn, mutate: (r: AgentRun) => void, intro: string, code?: string): Promise<void> {
  if (!run.checkoutId || !["checkout", "awaiting_consent"].includes(run.state)) {
    t.say("There's no open checkout yet. Tell me what to buy first.");
    return;
  }
  const s = await need(deps, run, t, [CAP.checkout]);
  if (!s) return;
  if (code && !(CAP.discount in s.active)) {
    t.log("capability", "Discount extension not negotiated", "warn");
    t.say("This session doesn't include the discount extension, so I can't apply codes.");
    return;
  }
  mutate(run);
  run.pending = undefined;
  t.say(intro);
  const cur = await s.client.getCheckout(run.checkoutId);
  const body = updateBody(cur.body as CheckoutView, run);
  const r = await s.client.updateCheckout(run.checkoutId, body);
  const co = r.body as CheckoutView;
  t.step("update_checkout", "Update checkout (full replacement)", r, "ok", `status ${co.status}; total ${rupees(total(co), co.currency)}`);
  if (code) {
    const rej = (co.messages ?? []).find((m) => m.type === "warning" && m.path?.startsWith("$.discounts"));
    const applied = co.discounts?.applied?.find((a) => a.code?.toUpperCase() === code);
    if (rej) {
      run.codes = run.codes.filter((c) => c !== code);
      t.log("fix", `Discount code ${code} rejected`, "warn", { detail: `${rej.code}: ${rej.content}` });
      t.say(`The merchant rejected ${code}: ${rej.content}`);
    } else if (applied) t.log("info", `Discount ${code} applied`, "ok", { detail: `${applied.title}: −${rupees(applied.amount)}` });
  }
  await resolveAndPresent(deps, run, t, s.client, co);
}

async function status(run: AgentRun, t: Turn, deps: AgentDeps): Promise<void> {
  // An open checkout that is not ready (for example after the buyer fixed their profile): re-read it and keep resolving.
  if (run.state === "checkout" && run.checkoutId) {
    const s = await need(deps, run, t, [CAP.checkout]);
    if (!s) return;
    const r = await s.client.getCheckout(run.checkoutId);
    t.step("update_checkout", "Get Checkout (status check)", r);
    t.say("Let me re-check the checkout.");
    await resolveAndPresent(deps, run, t, s.client, r.body as CheckoutView, undefined, true);
    return;
  }
  if (run.state === "idle") return t.say("We haven't started a purchase. Tell me what you'd like to buy.");
  if (run.state === "proposing") return t.say(`I'm waiting for you to choose among ${run.candidates.length} option(s).`);
  if (run.state === "ordered") return t.say(`Your order ${run.orderId} is placed. I'll hear about shipping through the merchant's webhooks.`);
  const p = run.pending && run.pending.type === "authorize" ? run.pending : undefined;
  t.say(`Checkout ${run.checkoutId}: ${p ? `ready, total ${rupees(p.expectedTotal, p.currency)}, waiting for your authorization.` : "in progress."}`);
}

async function cancelQuietly(deps: AgentDeps, run: AgentRun, t: Turn): Promise<void> {
  if (!run.checkoutId) return;
  const s = await deps.session();
  if (!s.client) return;
  const r = await s.client.cancelCheckout(run.checkoutId);
  t.step("cancel", `Canceled the previous checkout ${run.checkoutId}`, r, r.status === 200 ? "ok" : "warn");
  run.checkoutId = undefined;
}

async function cancel(deps: AgentDeps, run: AgentRun, t: Turn): Promise<void> {
  if (run.state === "checkout" || run.state === "awaiting_consent") await cancelQuietly(deps, run, t);
  const profile = run.profile;
  Object.assign(run, { ...emptyRun(run.id, profile), pending: undefined, checkoutId: undefined, orderId: undefined, handoffUrl: undefined, lastCardId: undefined, selectedIdx: undefined, transcript: run.transcript, timeline: run.timeline });
  t.log("cancel", "Started over", "info");
  t.say("Okay, I've stopped and cleared the shopping state. What would you like to buy?");
}

async function addToCart(deps: AgentDeps, run: AgentRun, t: Turn): Promise<void> {
  const s = await deps.session();
  const active = s.report.negotiation?.active ?? {};
  if (!(CAP.cart in active)) {
    t.log("capability", "Cart capability is not negotiated; skipping it", "info", { detail: "dev.ucp.shopping.cart is not in the capability intersection. I check before I call." });
    t.say("This merchant doesn't offer the cart capability (it isn't in what we negotiated), so I won't call it. I go straight from catalog to checkout, which works for a single purchase.");
    return;
  }
  t.say("The cart capability is negotiated, but this demo agent buys directly through checkout.");
}

/** Scenario helper: deliberately request a capability the merchant does not offer, then recover gracefully. */
export async function probeUnsupportedCapability(deps: AgentDeps, run: AgentRun): Promise<UcpResponse | null> {
  const now = deps.now ?? Date.now;
  const t = new Turn(run, now);
  const s = await deps.session();
  if (!s.client) return null;
  const r = await s.client.call("create_cart", { body: { line_items: [{ item: { id: "var_aurora_anc" }, quantity: 1 }] } });
  const m = firstMessage(r.body);
  t.step("capability", "Requested dev.ucp.shopping.cart (not offered by this merchant)", r, "warn", `${m?.code}: ${m?.content}`);
  t.say(`The merchant answered “${m?.code}”: the cart capability isn't something we both support. No problem; I'll use checkout directly instead.${(r.body as { continue_url?: string }).continue_url ? ` (It also offered ${(r.body as { continue_url?: string }).continue_url} for the web experience.)` : ""}`);
  return r;
}

async function placed(deps: AgentDeps, run: AgentRun, t: Turn, client: UcpClient, co: CheckoutView): Promise<void> {
  run.orderId = co.order!.id;
  run.state = "ordered";
  run.pending = undefined;
  t.log("complete", "Checkout completed", "ok", { detail: `order ${co.order!.id}` });
  const r = await client.getOrder(co.order!.id);
  t.step("order", `Get Order ${co.order!.id}`, r, r.status === 200 ? "ok" : "warn");
  const o = r.body as { label?: string; fulfillment?: { expectations?: { description?: string; fulfillable_on?: string }[] }; line_items?: { status: string }[] };
  const exp = o.fulfillment?.expectations?.[0];
  t.say(`Done! Order ${o.label ?? co.order!.id} is placed (simulated payment, nothing was charged). ${exp ? `Delivery: ${exp.description}, expected by ${exp.fulfillable_on}. ` : ""}I'll learn about shipping from the merchant's signed webhooks; see the Webhook Inspector.`);
  void deps;
}

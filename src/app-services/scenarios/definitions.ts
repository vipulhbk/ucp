import { resolveOrigin } from "@/config";
import { defer } from "@/lib/defer";
import { applyAction } from "@/merchant/orders/events";
import { outboxDeps } from "@/merchant/webhooks/deps";
import { flush, listRows } from "@/merchant/webhooks/outbox";
import type { CheckoutView } from "@/platform/agent/agent";
import { parseShopping } from "@/platform/agent/intent";
import { listReceipts, listSnapshots } from "@/platform/orders";
import { UcpClient } from "@/platform/ucp-client";
import { serializeUcpAgent } from "@/ucp/ucp-agent";
import { platformIdFor } from "@/ucp/platform-credential";
import { CARDS, exOf, fail, makeReady, money, need, replacement, totalOf } from "./helpers";
import { UCP_VERSION } from "@/ucp/constants";
import type { Env, ScenarioDef, ScenarioStep, StepResult } from "./types";

const HEADLINE = "Find me a wireless headphone under ₹5,000 with noise cancellation.";
const ok = (summary: string, extra: Partial<StepResult> = {}): StepResult => ({ ok: true, summary, exchanges: [], ...extra });
const fact = (label: string, value: string | number | undefined) => ({ label, value: String(value ?? "—") });
const co = (r: { body: unknown }) => r.body as CheckoutView;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A step where the BUYER must act. `run` prepares the confirmation; the scenario never authorizes for the buyer. */
function buyerStep(s: { id: string; title: string; protocol: string; instruction: string; defaultCardId?: string; prepare: (env: Env) => Promise<{ checkout: CheckoutView; exchanges: StepResult["exchanges"] } | StepResult>; verify: (env: Env) => Promise<StepResult> }): ScenarioStep {
  return {
    id: s.id,
    title: s.title,
    protocol: s.protocol,
    kind: "buyer",
    run: async (env) => {
      const p = await s.prepare(env);
      if ("ok" in p) return p;
      env.data.checkoutId = p.checkout.id;
      return ok(`Checkout ${p.checkout.id} is ready_for_complete at ${money(totalOf(p.checkout))}. Waiting for you.`, {
        exchanges: p.exchanges,
        needsBuyer: { type: "authorize", checkoutId: p.checkout.id, expectedTotal: totalOf(p.checkout), currency: p.checkout.currency, cards: CARDS, defaultCardId: s.defaultCardId ?? "visa_ok", instruction: s.instruction },
      });
    },
    verify: s.verify,
  };
}

const getCheckout = async (env: Env) => {
  const s = await env.session();
  const r = await need(s.client).getCheckout(String(env.data.checkoutId));
  return { r, c: co(r), client: need(s.client) };
};

/* ───────────────────────── 1. Merchant discovery ───────────────────────── */
const discovery: ScenarioDef = {
  id: "merchant-discovery",
  title: "Merchant discovery",
  summary: "How a platform finds a business, reads what it supports, and decides what it can use.",
  specRefs: ["overview → Profile Structure", "overview → Negotiation Protocol", "overview → Authority Binding"],
  steps: [
    {
      id: "request",
      title: "Agent requests merchant discovery",
      protocol: "Platform → Business: GET /.well-known/ucp (the platform sends its profile URL in UCP-Agent on later calls).",
      kind: "auto",
      run: async (env) => {
        const s = await env.discover("default");
        const ex = await env.exchangesFor(s.report.correlationId);
        return { ok: s.report.ok, summary: s.report.ok ? "Profile fetched, validated against the official schema and accepted." : `Discovery failed: ${s.report.error?.message}`, exchanges: ex, facts: [fact("HTTP status", s.report.fetch?.status), fact("Schema validation", s.report.profileValidation?.ok ? "ProfileBusinessSchema: ok" : "failed")] };
      },
    },
    {
      id: "profile",
      title: "Merchant returns its UCP profile; agent reads the supported services",
      protocol: "Business → Platform: { ucp: { version, services, capabilities, payment_handlers }, keys }. Services pair a transport (REST here) with an endpoint; the platform resolves OpenAPI paths against that endpoint.",
      kind: "auto",
      run: async (env) => {
        const r = (await env.session()).report;
        const svc = r.profile?.ucp.services["dev.ucp.shopping"]?.map((s) => `${s.transport} → ${s.endpoint ?? "(no endpoint)"}`).join("; ");
        return ok("Read from the profile, not assumed.", { facts: [fact("Protocol version", r.profile?.ucp.version), fact("dev.ucp.shopping", svc), fact("Resolved REST endpoint", r.rest?.endpoint), fact("Signing keys published", r.profile?.keys?.length ?? 0)] });
      },
    },
    {
      id: "capabilities",
      title: "Agent discovers the checkout capability (and what extends it)",
      protocol: "Platform intersects its capabilities with the business's by exact version, then prunes extensions whose parent is missing. Each schema URL must pass authority binding before it is trusted.",
      kind: "auto",
      run: async (env) => {
        const r = (await env.session()).report;
        const active = Object.entries(r.negotiation?.active ?? {});
        const hasCheckout = active.some(([n]) => n === "dev.ucp.shopping.checkout");
        return { ok: hasCheckout, summary: hasCheckout ? "dev.ucp.shopping.checkout is active, with its extensions." : "Checkout is not in the intersection.", exchanges: [], facts: [...active.map(([n, e]) => fact(n, `v${e.version}`)), fact("Excluded", r.negotiation?.excluded.length ? r.negotiation.excluded.map((x) => x.name).join(", ") : "none"), fact("Authority bindings", `${r.bindings.filter((b) => b.result.status === "valid").length} valid, ${r.bindings.filter((b) => b.result.status === "relaxed").length} relaxed (demo), ${r.bindings.filter((b) => b.result.status === "invalid").length} invalid`)] };
      },
    },
    {
      id: "handlers",
      title: "Agent determines the supported payment handlers",
      protocol: "payment_handlers advertises how instruments are acquired and processed; the same registry is echoed in every checkout response.",
      kind: "auto",
      run: async (env) => {
        const r = (await env.session()).report;
        return ok(r.paymentHandlers.length ? "A payment handler is available." : "No payment handler is advertised.", { facts: r.paymentHandlers.flatMap((h) => [fact("Handler", h.name), fact("id", h.id), fact("Instruments", h.instruments.join(", ")), fact("Simulated", h.simulated ? "yes: the credential provider and PSP behind it are fake" : "no")]) });
      },
    },
  ],
};

/* ───────────────────────── 2. Successful purchase ───────────────────────── */
const purchase: ScenarioDef = {
  id: "successful-purchase",
  title: "Successful purchase",
  summary: "Request → search → checkout → price → explicit buyer authorization → order. Payment is simulated.",
  specRefs: ["checkout/index.md → Flow, Status Lifecycle", "checkout/rest.md", "order/index.md"],
  steps: [
    { id: "request", title: "Shopper submits a product request", protocol: "(Platform-internal) The shopper expresses intent in natural language; the platform turns it into catalog search parameters.", kind: "auto", run: async () => { const i = parseShopping(HEADLINE); return ok(`“${HEADLINE}”`, { facts: [fact("Query", i.query), fact("Budget cap", money(i.maxPaise ?? 0)), fact("Required features", i.require.join(" + ")), fact("Parsed by", "deterministic rules, no model")] }); } },
    {
      id: "search",
      title: "Agent searches the merchant catalog",
      protocol: "POST /catalog/search (dev.ucp.shopping.catalog.search) with the query and a price filter in minor units.",
      kind: "auto",
      run: async (env) => {
        const s = await env.discover("default");
        const i = parseShopping(HEADLINE);
        const r = await need(s.client).searchCatalog({ query: i.query, filters: { price: { max: i.maxPaise } }, pagination: { limit: 20 } });
        const products = (r.body as { products: { id: string; title: string; tags?: string[]; price_range: { min: { amount: number } }; rating?: { value: number }; variants: { id: string }[] }[] }).products;
        const fit = products.filter((p) => i.require.every((q) => (p.tags ?? []).includes(q) || (q === "wireless" && (p.tags ?? []).includes("bluetooth")))).sort((a, b) => (b.rating?.value ?? 0) - (a.rating?.value ?? 0));
        if (fit[0]) {
          env.data.variantId = fit[0].variants[0]!.id;
          env.data.title = fit[0].title;
          env.data.price = fit[0].price_range.min.amount;
        }
        return { ok: r.status === 200 && !!fit[0], summary: `${products.length} results; ${fit.length} meet every requirement (the agent verifies features itself).`, exchanges: exOf(r), facts: [fact("Results", products.length), fact("Meeting all requirements", fit.length)] };
      },
    },
    { id: "select", title: "Agent selects a product", protocol: "(Platform-internal) Best rated product that satisfies the buyer's constraints.", kind: "auto", run: async (env) => (env.data.variantId ? ok(`Selected ${env.data.title}.`, { facts: [fact("Variant (item.id)", env.data.variantId), fact("Catalog price", money(Number(env.data.price)))] }) : fail("No product satisfied the request.")) },
    {
      id: "create",
      title: "Agent creates checkout",
      protocol: "POST /checkout-sessions with line_items [{ item.id, quantity }] only. Prices are never sent: the business is authoritative.",
      kind: "auto",
      run: async (env) => {
        const r = await need((await env.session()).client).createCheckout({ line_items: [{ item: { id: String(env.data.variantId) }, quantity: 1 }] });
        env.data.checkoutId = co(r).id;
        return { ok: r.status === 201, summary: `201 Created: ${co(r).id}`, exchanges: exOf(r), facts: [fact("status", co(r).status)] };
      },
    },
    {
      id: "session",
      title: "Merchant returns the checkout session",
      protocol: "The response carries status, messages[] (what is missing, with JSON paths and severity), totals, links, expires_at, and the payment handlers.",
      kind: "auto",
      run: async (env) => {
        const { r, c } = await getCheckout(env);
        const errs = (c.messages ?? []).filter((m) => m.type === "error");
        return { ok: r.status === 200, summary: `Status “${c.status}”: ${errs.length} recoverable message(s) tell the platform what to supply.`, exchanges: exOf(r), facts: errs.map((m) => fact(`${m.severity}`, `${m.code} at ${m.path}`)) };
      },
    },
    {
      id: "update",
      title: "Agent updates quantities (and fills buyer and address)",
      protocol: "PUT /checkout-sessions/{id}: a FULL replacement. Everything the platform wants to keep must be resent.",
      kind: "auto",
      run: async (env) => {
        const { client } = await getCheckout(env);
        const first = (await client.getCheckout(String(env.data.checkoutId))).body as CheckoutView;
        const ex = [];
        let c = first;
        for (let i = 0; i < 3 && c.status !== "ready_for_complete"; i++) {
          const u = await client.updateCheckout(c.id, replacement(c, { quantity: 2 }));
          ex.push(u.exchange);
          c = u.body as CheckoutView;
        }
        return { ok: c.status === "ready_for_complete", summary: `Quantity set to 2; status is now “${c.status}”.`, exchanges: ex, facts: [fact("quantity", c.line_items[0]?.quantity)] };
      },
    },
    {
      id: "price",
      title: "Merchant calculates the final price",
      protocol: "totals[] is recomputed by the business (subtotal, discounts, shipping, tax, total) in minor units.",
      kind: "auto",
      run: async (env) => {
        const { r, c } = await getCheckout(env);
        return { ok: r.status === 200, summary: `Final price ${money(totalOf(c))}, calculated by the merchant.`, exchanges: exOf(r), facts: c.totals.map((t) => fact(t.type, money(t.amount))) };
      },
    },
    buyerStep({
      id: "authorize",
      title: "Shopper reviews the checkout and explicitly authorizes the (simulated) purchase",
      protocol: "UCP requires the checkout be finalized through a trusted UI unless AP2 mandates are used. AP2 is NOT implemented here, so only your click authorizes. The platform then tokenizes the test card and calls POST …/complete with the token.",
      instruction: "Review the amounts, choose a payment method, and click the authorize button. The agent cannot do this for you.",
      prepare: async (env) => {
        const { r, c } = await getCheckout(env);
        return c.status === "ready_for_complete" ? { checkout: c, exchanges: exOf(r) } : fail(`Checkout is ${c.status}, not ready_for_complete.`);
      },
      verify: async (env) => {
        const { r, c } = await getCheckout(env);
        return { ok: c.status === "completed", summary: c.status === "completed" ? "You authorized, the card was tokenized, and the merchant accepted completion." : `Not authorized yet (checkout is ${c.status}).`, exchanges: exOf(r) };
      },
    }),
    {
      id: "complete",
      title: "Merchant completes checkout",
      protocol: "POST …/complete returns status “completed” with an order {id, permalink_url}. The payment credential was a token, never a card number.",
      kind: "auto",
      run: async (env) => {
        const { r, c } = await getCheckout(env);
        env.data.orderId = c.order?.id;
        return { ok: c.status === "completed" && !!c.order, summary: `Status ${c.status}; order ${c.order?.id}.`, exchanges: exOf(r), facts: [fact("order.id", c.order?.id), fact("instrument", JSON.stringify((r.body as { payment?: { instruments?: { display?: unknown }[] } }).payment?.instruments?.[0]?.display ?? {}))] };
      },
    },
    {
      id: "order",
      title: "Merchant creates the order",
      protocol: "GET /orders/{id}: the full current-state snapshot (line items with quantity.original/total/fulfilled, fulfillment expectations, totals).",
      kind: "auto",
      run: async (env) => {
        const s = await env.session();
        const r = await need(s.client).getOrder(String(env.data.orderId));
        const o = r.body as { label?: string; line_items?: { status: string }[]; fulfillment?: { expectations?: { description?: string }[] } };
        return { ok: r.status === 200, summary: `Order ${o.label} retrieved.`, exchanges: exOf(r), facts: [fact("line item status", o.line_items?.[0]?.status), fact("expectation", o.fulfillment?.expectations?.[0]?.description)] };
      },
    },
    { id: "result", title: "Agent receives the result", protocol: "(Platform) The agent reports the order to the shopper; later updates arrive as signed webhooks.", kind: "auto", run: async (env) => ok(`Order ${env.data.orderId} placed (simulated payment, nothing charged).`, { facts: [fact("Next", "Merchant shipping events arrive as signed webhooks: see the Webhook Inspector.")] }) },
  ],
};

/* ───────────────────────── 3. Unsupported capability ───────────────────────── */
const unsupported: ScenarioDef = {
  id: "unsupported-capability",
  title: "Unsupported capability",
  summary: "The platform asks for something the business does not offer, receives the spec'd error, and recovers.",
  specRefs: ["overview → Error Handling → capabilities_incompatible", "overview → Intersection Algorithm"],
  steps: [
    {
      id: "discover",
      title: "Agent discovers the merchant's capabilities",
      protocol: "Fetch /.well-known/ucp and intersect. This platform fixture also advertises dev.ucp.shopping.cart, which the business does not.",
      kind: "auto",
      run: async (env) => {
        const s = await env.discover("with-cart");
        const active = Object.keys(s.report.negotiation?.active ?? {});
        return { ok: s.report.ok, summary: `${active.length} capabilities negotiated; cart is not among them.`, exchanges: await env.exchangesFor(s.report.correlationId), facts: [fact("Active", active.map((a) => a.replace("dev.ucp.shopping.", "")).join(", ")), fact("Cart negotiated", active.includes("dev.ucp.shopping.cart") ? "yes" : "no: the business does not advertise it")] };
      },
    },
    {
      id: "request",
      title: "Agent requests the unsupported capability",
      protocol: "A well-behaved agent would not call a capability that is not in the intersection. Here it does so deliberately, to show the business's answer: POST /carts.",
      kind: "auto",
      run: async (env) => {
        const s = await env.session();
        const r = await need(s.client).call("create_cart", { body: { line_items: [{ item: { id: "var_aurora_anc" }, quantity: 1 }] } });
        env.data.errorCode = (r.body as { messages?: { code?: string }[] }).messages?.[0]?.code;
        return { ok: r.status === 200, summary: `HTTP ${r.status}`, exchanges: exOf(r) };
      },
    },
    {
      id: "error",
      title: "Merchant returns the appropriate error",
      protocol: "No mutually supported version of a capability the operation needs → capabilities_incompatible: HTTP 200 with ucp.status “error”, messages[] and a continue_url fallback. (Discovery/version failures are transport errors; this is a business outcome.)",
      kind: "auto",
      run: async (env) => ({ ok: env.data.errorCode === "capabilities_incompatible", summary: `Business said “${env.data.errorCode}” as the specification requires.`, exchanges: [], facts: [fact("code", env.data.errorCode), fact("HTTP status", "200 (a UCP error body, not a transport error)")] }),
    },
    {
      id: "recover",
      title: "Agent handles the failure gracefully",
      protocol: "Fall back to a capability both sides support: create a checkout directly.",
      kind: "auto",
      run: async (env) => {
        const s = await env.session();
        const r = await need(s.client).createCheckout({ line_items: [{ item: { id: "var_aurora_anc" }, quantity: 1 }] });
        env.data.checkoutId = co(r).id;
        return { ok: r.status === 201, summary: "Checkout created through the supported capability. The failure cost the shopper nothing.", exchanges: exOf(r), facts: [fact("checkout", co(r).id)] };
      },
    },
  ],
};

/* ───────────────────────── 4. Payment failure and retry ───────────────────────── */
const paymentFailure: ScenarioDef = {
  id: "payment-failure",
  title: "Payment failure and retry",
  summary: "A simulated decline is a recoverable error; the buyer retries with another card and succeeds.",
  specRefs: ["checkout/index.md → Standard Errors (payment_failed)", "checkout/index.md → Error Processing Algorithm"],
  steps: [
    {
      id: "create",
      title: "Agent creates a checkout and brings it to ready_for_complete",
      protocol: "POST /checkout-sessions, then PUT updates until the business reports ready_for_complete.",
      kind: "auto",
      run: async (env) => {
        const s = await env.discover("default");
        const m = await makeReady(need(s.client));
        env.data.checkoutId = m.co.id;
        return { ok: m.ok, summary: `Ready at ${money(totalOf(m.co))}.`, exchanges: m.exchanges };
      },
    },
    buyerStep({
      id: "decline",
      title: "Buyer selects the declined test card and authorizes",
      protocol: "Platform tokenizes the card at the handler, then POST …/complete with the token. The simulated PSP will decline.",
      instruction: "Choose “Visa · always declined” for this step, then authorize.",
      defaultCardId: "visa_declined",
      prepare: async (env) => {
        const { r, c } = await getCheckout(env);
        return c.status === "ready_for_complete" ? { checkout: c, exchanges: exOf(r) } : fail(`Checkout is ${c.status}.`);
      },
      verify: async (env) => {
        const { r, c } = await getCheckout(env);
        const failed = (c.messages ?? []).find((m) => m.code === "payment_failed");
        if (c.status === "completed") return { ok: false, summary: "That card was approved, so the order completed and the decline cannot be shown. Reset the scenario and pick the declined card.", exchanges: exOf(r) };
        return { ok: !!failed, summary: failed ? "The payment was declined (simulated)." : `No failure recorded yet (checkout is ${c.status}).`, exchanges: exOf(r) };
      },
    }),
    {
      id: "failure",
      title: "Payment simulator returns a failure",
      protocol: "A decline is NOT an HTTP error: Complete returns 200 with status “incomplete” and a recoverable error message payment_failed whose path points at the instrument.",
      kind: "auto",
      run: async (env) => {
        const { r, c } = await getCheckout(env);
        const m = (c.messages ?? []).find((x) => x.code === "payment_failed");
        return { ok: !!m && c.status === "incomplete", summary: `status “${c.status}”, ${m?.code} (${m?.severity}) at ${m?.path}`, exchanges: exOf(r), facts: [fact("message", m?.content), fact("Charged", "nothing; no order exists")] };
      },
    },
    {
      id: "display",
      title: "Agent displays the error and resolves it through Update",
      protocol: "Recoverable errors are resolved with Update Checkout; the failed instrument is cleared and the checkout returns to ready_for_complete. A new Complete will need a fresh Idempotency-Key.",
      kind: "auto",
      run: async (env) => {
        const { c, client } = await getCheckout(env);
        const u = await client.updateCheckout(c.id, replacement(c));
        return { ok: co(u).status === "ready_for_complete", summary: `Agent to buyer: “That card was declined. Nothing was charged. Please authorize with a different card.” Status back to ${co(u).status}.`, exchanges: exOf(u) };
      },
    },
    buyerStep({
      id: "retry",
      title: "Buyer retries with another card and authorizes again",
      protocol: "Fresh consent (the previous one was single-use), fresh tokenization, fresh Idempotency-Key.",
      instruction: "Choose an approved card (for example “Mastercard · always approved”) and authorize.",
      defaultCardId: "mc_ok",
      prepare: async (env) => {
        const { r, c } = await getCheckout(env);
        return c.status === "ready_for_complete" ? { checkout: c, exchanges: exOf(r) } : fail(`Checkout is ${c.status}.`);
      },
      verify: async (env) => {
        const { r, c } = await getCheckout(env);
        env.data.orderId = c.order?.id;
        return { ok: c.status === "completed", summary: c.status === "completed" ? "Approved on the second attempt." : `Still ${c.status}: that attempt did not succeed.`, exchanges: exOf(r) };
      },
    }),
    {
      id: "success",
      title: "Transaction succeeds",
      protocol: "Platform → Business: GET /orders/{id} returns the order that the successful Complete Checkout created (exactly one).",
      kind: "auto",
      run: async (env) => {
        const s = await env.session();
        const r = await need(s.client).getOrder(String(env.data.orderId));
        return { ok: r.status === 200, summary: `Order ${env.data.orderId} exists, created exactly once.`, exchanges: exOf(r) };
      },
    },
  ],
};

/* ───────────────────────── 5. Order lifecycle ───────────────────────── */
const lifecycle: ScenarioDef = {
  id: "order-lifecycle",
  title: "Order lifecycle",
  summary: "The business ships an order; a signed webhook carries the new state to the platform, which verifies and applies it.",
  specRefs: ["order/index.md → Events, Webhook Signature Verification", "signatures.md"],
  steps: [
    buyerStep({
      id: "created",
      title: "An order is created (you buy something)",
      protocol: "Complete Checkout creates the order and the business sends an “Order created” webhook with the full entity.",
      instruction: "Authorize this simulated purchase to create the order.",
      prepare: async (env) => {
        const s = await env.discover("default");
        const m = await makeReady(need(s.client));
        return m.ok ? { checkout: m.co, exchanges: m.exchanges } : fail("Could not prepare a checkout.");
      },
      verify: async (env) => {
        const { r, c } = await getCheckout(env);
        env.data.orderId = c.order?.id;
        return { ok: c.status === "completed", summary: c.status === "completed" ? `Order ${c.order?.id} created.` : `Checkout is ${c.status}.`, exchanges: exOf(r) };
      },
    }),
    {
      id: "ship",
      title: "Merchant updates the order (marks it shipped)",
      protocol: "NOT a UCP call: the business appends a fulfillment event to the order. UCP defines only the resulting snapshot and its webhook.",
      kind: "auto",
      run: async (env) => {
        const r = await applyAction({ store: env.store, platformId: platformIdFor(env.ctx.sid), origin: resolveOrigin(env.req), now: Date.now, defer }, String(env.data.orderId), "ship");
        return r.ok ? ok("Fulfillment event appended; a new snapshot was queued for the platform.", { facts: [fact("event", (r.order.events.at(-1) as { type?: string })?.type), fact("tracking", (r.order.events.at(-1) as { tracking_number?: string })?.tracking_number)] }) : fail(r.message);
      },
    },
    {
      id: "webhook",
      title: "A webhook is generated and delivered",
      protocol: "Business → Platform: POST webhook_url with Webhook-Id, Webhook-Timestamp, UCP-Agent, Content-Digest, Signature-Input, Signature (RFC 9421, ES256). The body is the full order entity.",
      kind: "auto",
      run: async (env) => {
        const pid = platformIdFor(env.ctx.sid);
        const deps = outboxDeps(resolveOrigin(env.req));
        await flush(deps, pid, { force: true });
        const rows = (await listRows(env.store, pid)).filter((r) => r.orderId === env.data.orderId);
        const shipped = rows.find((r) => r.summary === "Shipped");
        env.data.webhookId = shipped?.id;
        return { ok: shipped?.status === "delivered", summary: shipped ? `Webhook ${shipped.id}: ${shipped.status} after ${shipped.attempts.length} attempt(s).` : "No webhook was queued (did the platform advertise a webhook_url?).", exchanges: [], facts: [fact("Webhook-Id", shipped?.id), fact("Signed payload bytes", shipped?.body.length), fact("Receiver HTTP status", shipped?.attempts.at(-1)?.status)] };
      },
    },
    {
      id: "receive",
      title: "Platform receives and verifies the event",
      protocol: "Platform: verify the signature with the key in the business profile → check the signer owns the order → dedupe by Webhook-Id → ack 2xx → apply asynchronously.",
      kind: "auto",
      run: async (env) => {
        const pid = platformIdFor(env.ctx.sid);
        let rec;
        for (let i = 0; i < 20 && !rec; i++) {
          rec = (await listReceipts(env.store, pid)).find((x) => x.webhookId === env.data.webhookId && x.outcome === "applied");
          if (!rec) await sleep(100);
        }
        return { ok: !!rec, summary: rec ? `Verified (${rec.alg}) and applied.` : "The receipt is not applied yet.", exchanges: [], facts: [fact("Signature", rec ? `✓ ${rec.alg}, kid ${String(rec.keyid).slice(0, 8)}…` : undefined), fact("Authorized", rec ? "signer is the business that owns the order" : undefined), fact("Outcome", rec?.outcome)] };
      },
    },
    {
      id: "dashboard",
      title: "The order dashboard reflects the update",
      protocol: "The platform's state was built only from the verified webhook; it must equal the business's own snapshot from Get Order.",
      kind: "auto",
      run: async (env) => {
        const s = await env.session();
        const r = await need(s.client).getOrder(String(env.data.orderId));
        const snap = (await listSnapshots(env.store, platformIdFor(env.ctx.sid))).find((x) => x.order.id === env.data.orderId);
        const same = !!snap && JSON.stringify(snap.order) === JSON.stringify(r.body);
        return { ok: same, summary: same ? "Platform state equals the business's Get Order snapshot: the webhook channel converged." : "Platform state differs from the business's.", exchanges: exOf(r), facts: [fact("Events on the order", ((r.body as { fulfillment?: { events?: unknown[] } }).fulfillment?.events ?? []).length)] };
      },
    },
  ],
};

/* ───────────────────────── 6. Version compatibility ───────────────────────── */
const versions: ScenarioDef = {
  id: "version-compatibility",
  title: "Version compatibility",
  summary: "Protocol version selection, capability version intersection, and what happens when they do not line up.",
  specRefs: ["overview → Versioning → Protocol Version, Capability Versions", "overview → Error Codes (version_unsupported)"],
  steps: [
    {
      id: "compatible",
      title: "Compatible case: same protocol and capability versions",
      protocol: "Platform picks the most recent mutual protocol version, then intersects capabilities by exact version equality.",
      kind: "auto",
      run: async (env) => {
        const s = await env.discover("default");
        const vs = s.report.versionSelection;
        return { ok: s.report.ok, summary: `Selected ${vs && vs.kind !== "unsupported" ? vs.version : "?"}; ${Object.keys(s.report.negotiation?.active ?? {}).length} capabilities active.`, exchanges: await env.exchangesFor(s.report.correlationId), facts: [fact("Business offers", UCP_VERSION), fact("Platform supports", UCP_VERSION)] };
      },
    },
    {
      id: "incompatible",
      title: "Incompatible case: the platform only speaks 2026-01-11",
      protocol: "No version in common (the business advertises no supported_versions): the platform SHOULD NOT send requests; a business MUST answer version_unsupported (HTTP 422).",
      kind: "auto",
      run: async (env) => {
        const s = await env.discover("old-version");
        const bad = s.report.error?.kind === "version_unsupported";
        return { ok: bad, summary: bad ? `Platform-side check stops here: ${s.report.error?.message}.` : "Expected a version_unsupported failure.", exchanges: await env.exchangesFor(s.report.correlationId), facts: [fact("Business offers", UCP_VERSION), fact("Platform supports", "2026-01-11"), fact("Result", s.report.error?.kind)] };
      },
    },
    {
      id: "enforce",
      title: "The business enforces it even if the platform ignores the check",
      protocol: "A business MUST validate the platform's version on every request. Here a platform skips discovery's verdict and calls anyway.",
      kind: "auto",
      run: async (env) => {
        const old = await env.discover("old-version"); // only for its credentials/recorder; discovery itself reports the failure
        const self = resolveOrigin(env.req);
        const q = new URLSearchParams({ variant: "old-version", p: platformIdFor(env.ctx.sid) });
        const client = new UcpClient({ sid: env.ctx.sid, endpoint: `${self}/api/ucp/v1`, platformProfileUrl: `${self}/api/platform/profile?${q}`, apiKey: old.apiKey, recorder: old.recorder, fetchOptions: old.fetchOptions });
        const r = await client.createCheckout({ line_items: [{ item: { id: "var_glide_mouse" }, quantity: 1 }] }, { actorNote: "forced call by a platform that ignored its own version check" });
        const code = (r.body as { messages?: { code?: string }[] }).messages?.[0]?.code;
        return { ok: r.status === 422 && code === "version_unsupported", summary: `Business answered HTTP ${r.status} ${code}: no resource was created.`, exchanges: exOf(r), facts: [fact("Response ucp.version", (r.body as { ucp?: { version?: string } }).ucp?.version), fact("UCP-Agent", serializeUcpAgent(`${self}/api/platform/profile?${q}`).slice(0, 60) + "…")] };
      },
    },
    {
      id: "skew",
      title: "Capability version skew: discount advertised at a different version",
      protocol: "Capability compatibility is exact version equality, not date order. No mutual version → the capability (and anything depending on it) is excluded.",
      kind: "auto",
      run: async (env) => {
        const s = await env.discover("discount-skew");
        const r = await need(s.client).createCheckout({ line_items: [{ item: { id: "var_glide_mouse" }, quantity: 1 }], discounts: { codes: ["WELCOME10"] } });
        const caps = Object.keys((r.body as { ucp?: { capabilities?: object } }).ucp?.capabilities ?? {});
        return { ok: !caps.includes("dev.ucp.shopping.discount") && caps.includes("dev.ucp.shopping.checkout"), summary: "Checkout still works; the discount extension is not active, so the code was ignored with an info message.", exchanges: exOf(r), facts: [fact("Capabilities in the response", caps.map((c) => c.replace("dev.ucp.shopping.", "")).join(", ")), fact("Excluded by negotiation", s.report.negotiation?.excluded.map((x) => `${x.name} (${x.reason})`).join("; "))] };
      },
    },
    { id: "restore", title: "Restore the compatible platform", protocol: "(Housekeeping) Later pages use the compatible platform again.", kind: "auto", run: async (env) => { const s = await env.discover("default"); return { ok: s.report.ok, summary: "Back to the compatible platform fixture.", exchanges: [] }; } },
  ],
};

/* ───────────────────────── 7. Discount and fulfillment ───────────────────────── */
const extensions: ScenarioDef = {
  id: "discount-fulfillment",
  title: "Discount and fulfillment extensions",
  summary: "Extensions advertised by the business, discount codes accepted and rejected, shipping options computed by the merchant.",
  specRefs: ["extensions/discount.md", "extensions/fulfillment.md", "overview → Extensions"],
  steps: [
    {
      id: "create",
      title: "Agent creates a checkout; the merchant advertises its extensions",
      protocol: "Extensions declare `extends`; the response's ucp.capabilities lists the active, relevant ones (checkout, fulfillment, discount) and not unrelated ones.",
      kind: "auto",
      run: async (env) => {
        const s = await env.discover("default");
        const r = await need(s.client).createCheckout({ line_items: [{ item: { id: "var_summit_pro_anc" }, quantity: 2 }] });
        env.data.checkoutId = co(r).id;
        const caps = Object.keys((r.body as { ucp?: { capabilities?: object } }).ucp?.capabilities ?? {});
        return { ok: r.status === 201, summary: `Active in this response: ${caps.map((c) => c.replace("dev.ucp.shopping.", "")).join(", ")}.`, exchanges: exOf(r), facts: [fact("Subtotal", money(co(r).totals.find((t) => t.type === "subtotal")?.amount ?? 0))] };
      },
    },
    {
      id: "codes",
      title: "Agent requests discounts",
      protocol: "PUT with discounts.codes (replacement semantics, case-insensitive). Three codes: one per-item, one order-level, one expired.",
      kind: "auto",
      run: async (env) => {
        const { c, client } = await getCheckout(env);
        const u = await client.updateCheckout(c.id, replacement(c, { codes: ["welcome10", "FLAT500", "SUMMER20"] }));
        return { ok: u.status === 200, summary: "Sent three codes in one update.", exchanges: exOf(u), facts: [fact("Submitted", "welcome10, FLAT500, SUMMER20")] };
      },
    },
    {
      id: "eligible",
      title: "Merchant returns the eligible discounts",
      protocol: "discounts.applied[] (method each/across, priority, allocations), rejected codes echoed in codes[] with a warning message and a spec code, plus an automatic discount the platform cannot remove.",
      kind: "auto",
      run: async (env) => {
        const { r, c } = await getCheckout(env);
        const warn = (c.messages ?? []).filter((m) => m.type === "warning");
        return { ok: (c.discounts?.applied?.length ?? 0) >= 2 && warn.length >= 1, summary: `${c.discounts?.applied?.length} applied, ${warn.length} rejected.`, exchanges: exOf(r), facts: [...(c.discounts?.applied ?? []).map((a) => fact(a.automatic ? "automatic" : (a.code ?? "?"), `${a.title}: −${money(a.amount)}`)), ...warn.map((m) => fact("rejected", `${m.code} at ${m.path}`))] };
      },
    },
    {
      id: "fulfillment",
      title: "Fulfillment options are calculated",
      protocol: "The platform sends a destination; the business returns groups[].options[] with prices. The merchant, not the platform, computes shipping.",
      kind: "auto",
      run: async (env) => {
        const { r, c } = await getCheckout(env);
        const opts = c.fulfillment?.methods?.[0]?.groups?.[0]?.options ?? [];
        return { ok: opts.length >= 2, summary: `${opts.length} options for the delivery address.`, exchanges: exOf(r), facts: opts.map((o) => fact(o.id, `${o.title}: ${money(o.totals[0]!.amount)}`)) };
      },
    },
    {
      id: "update",
      title: "Checkout is updated with the chosen option",
      protocol: "PUT with selected_option_id; totals are recomputed and the checkout reaches ready_for_complete.",
      kind: "auto",
      run: async (env) => {
        const { c, client } = await getCheckout(env);
        const u = await client.updateCheckout(c.id, replacement(c, { option: "express" }));
        const after = co(u);
        return { ok: after.status === "ready_for_complete", summary: `Express chosen; total ${money(totalOf(after))}; status ${after.status}.`, exchanges: exOf(u), facts: after.totals.map((t) => fact(t.type, money(t.amount))) };
      },
    },
  ],
};

export const SCENARIOS: ScenarioDef[] = [discovery, purchase, unsupported, paymentFailure, lifecycle, versions, extensions];
export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);

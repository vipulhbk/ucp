import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, Browser } from "./env";

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => void (srv = await startServer()));
afterAll(() => srv.close());

const tot = (c: any) => c.totals.find((t: any) => t.type === "total").amount as number;
const addr = { type: "shipping_address", id: "dest_1", street_address: "12 MG Road", address_locality: "Bengaluru", address_region: "KA", postal_code: "560001", address_country: "IN" };

async function ready(b: Browser, items = [{ id: "var_aurora_anc", quantity: 1 }]) {
  const created = await b.call("create_checkout", { body: { line_items: items.map((i) => ({ item: { id: i.id }, quantity: i.quantity })) } });
  expect(created.status).toBe(200);
  const co = created.body.body;
  const upd = await b.call("update_checkout", {
    id: co.id,
    body: {
      line_items: co.line_items.map((l: any) => ({ id: l.id, item: { id: l.item.id }, quantity: l.quantity })),
      buyer: { email: "asha@example.com", first_name: "Asha" },
      fulfillment: { methods: [{ id: "method_1", type: "shipping", line_item_ids: co.line_items.map((l: any) => l.id), destinations: [addr], selected_destination_id: "dest_1", groups: [{ id: "group_1", selected_option_id: "standard" }] }] },
    },
  });
  expect(upd.body.body.status).toBe("ready_for_complete");
  return upd.body.body;
}

describe("playground BFF → platform UCP client → business (real HTTP end to end)", () => {
  it("runs a full purchase; the agent-side path cannot complete without the buyer's consent", async () => {
    const b = new Browser(srv.origin);
    const disc = await b.post("/api/playground/discovery/fetch", { variant: "default" });
    expect(disc.body.ok).toBe(true);
    expect(disc.body.rest.endpoint).toBe(`${srv.origin}/api/ucp/v1`);

    const co = await ready(b);

    // 1) the generic call route refuses Complete outright
    const viaCall = await b.call("complete_checkout" as never, { id: co.id, body: {} });
    expect(viaCall.status).toBe(400);

    // 2) the complete route refuses without consent
    const noConsent = await b.post("/api/playground/checkout/complete", { checkoutId: co.id, cardId: "visa_ok" });
    expect(noConsent.status).toBe(403);
    expect(noConsent.body.error).toMatchObject({ kind: "consent", code: "missing" });

    // 3) the buyer authorizes exactly what they see
    const consent = await b.post("/api/playground/checkout/consent", { checkoutId: co.id, cardId: "visa_ok", expectedTotal: tot(co) });
    expect(consent.status).toBe(200);
    expect(consent.body.consent.summary).toMatchObject({ checkoutId: co.id, currency: "INR", paymentMethod: { cardId: "visa_ok" }, shipping: { optionId: "standard" } });
    expect(consent.body.consent.summary.total).toBe(co.totals.find((t: any) => t.type === "total").amount);

    // 4) now Complete works: tokenize at the advertised handler, then Complete with a token credential
    const done = await b.post("/api/playground/checkout/complete", { checkoutId: co.id, cardId: "visa_ok" });
    expect(done.status).toBe(200);
    expect(done.body.tokenize.status).toBe(200);
    expect(done.body.tokenize.body.token).toBe("[REDACTED]");
    expect(done.body.complete.body.status).toBe("completed");
    expect(done.body.complete.body.order.id).toMatch(/^ord_/);

    // consent is single-use
    const again = await b.post("/api/playground/checkout/complete", { checkoutId: co.id, cardId: "visa_ok" });
    expect([403, 409]).toContain(again.status);

    // the order is retrievable through the same path
    const ord = await b.call("get_order", { id: done.body.complete.body.order.id });
    expect(ord.body.status).toBe(200);
    expect(ord.body.validation.every((v: any) => v.ok)).toBe(true);
  });

  it("consent is void if the checkout changes after the buyer authorized it", async () => {
    const b = new Browser(srv.origin);
    const co = await ready(b, [{ id: "var_glide_mouse", quantity: 1 }]);
    await b.post("/api/playground/checkout/consent", { checkoutId: co.id, cardId: "visa_ok", expectedTotal: tot(co) });
    // someone (the agent) changes the quantity after the buyer clicked authorize
    await b.call("update_checkout", {
      id: co.id,
      body: {
        line_items: [{ id: "li_1", item: { id: "var_glide_mouse" }, quantity: 5 }],
        buyer: { email: "asha@example.com" },
        fulfillment: { methods: [{ id: "method_1", type: "shipping", line_item_ids: ["li_1"], destinations: [addr], selected_destination_id: "dest_1", groups: [{ id: "group_1", selected_option_id: "standard" }] }] },
      },
    });
    const r = await b.post("/api/playground/checkout/complete", { checkoutId: co.id, cardId: "visa_ok" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("mismatch");
  });

  it("the buyer can only authorize the total they were shown", async () => {
    const b = new Browser(srv.origin);
    const co = await ready(b);
    const wrong = await b.post("/api/playground/checkout/consent", { checkoutId: co.id, cardId: "visa_ok", expectedTotal: tot(co) - 1 });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toMatchObject({ code: "mismatch", message: expect.stringContaining("total changed") });
    const missing = await b.post("/api/playground/checkout/consent", { checkoutId: co.id, cardId: "visa_ok" });
    expect(missing.status).toBe(400); // expectedTotal is mandatory
    // nothing was recorded, so Complete is still impossible
    expect((await b.post("/api/playground/checkout/complete", { checkoutId: co.id, cardId: "visa_ok" })).status).toBe(403);
  });
  it("authorize = consent + complete in one buyer click, also bound to the shown total", async () => {
    const b = new Browser(srv.origin);
    const co = await ready(b);
    expect((await b.post("/api/playground/checkout/authorize", { checkoutId: co.id, cardId: "visa_ok", expectedTotal: 1 })).status).toBe(403);
    const ok = await b.post("/api/playground/checkout/authorize", { checkoutId: co.id, cardId: "visa_ok", expectedTotal: tot(co) });
    expect(ok.status).toBe(200);
    expect(ok.body.complete.body.status).toBe("completed");
    expect(ok.body.consent.summary.total).toBe(tot(co));
  });

  it("consent cannot be granted for a checkout that is not ready", async () => {
    const b = new Browser(srv.origin);
    const created = await b.call("create_checkout", { body: { line_items: [{ item: { id: "var_glide_mouse" }, quantity: 1 }] } });
    const r = await b.post("/api/playground/checkout/consent", { checkoutId: created.body.body.id, cardId: "visa_ok", expectedTotal: tot(created.body.body) });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("not_ready");
  });

  it("payment failure then retry with a different card, each with fresh consent", async () => {
    const b = new Browser(srv.origin);
    const co = await ready(b);
    await b.post("/api/playground/checkout/consent", { checkoutId: co.id, cardId: "visa_declined", expectedTotal: tot(co) });
    const bad = await b.post("/api/playground/checkout/complete", { checkoutId: co.id, cardId: "visa_declined" });
    expect(bad.body.complete.body.status).toBe("incomplete");
    expect(bad.body.complete.body.messages).toContainEqual(expect.objectContaining({ code: "payment_failed" }));

    const fresh = (await b.call("get_checkout", { id: co.id })).body.body;
    await b.call("update_checkout", { id: co.id, body: { line_items: fresh.line_items.map((l: any) => ({ id: l.id, item: { id: l.item.id }, quantity: l.quantity })), buyer: fresh.buyer, fulfillment: { methods: [{ id: "method_1", type: "shipping", line_item_ids: ["li_1"], destinations: [addr], selected_destination_id: "dest_1", groups: [{ id: "group_1", selected_option_id: "standard" }] }] } } });

    // the declined card's consent is gone; the buyer must authorize the new method
    const noConsent = await b.post("/api/playground/checkout/complete", { checkoutId: co.id, cardId: "mc_ok" });
    expect(noConsent.status).toBe(403);
    await b.post("/api/playground/checkout/consent", { checkoutId: co.id, cardId: "mc_ok", expectedTotal: tot(co) });
    const ok = await b.post("/api/playground/checkout/complete", { checkoutId: co.id, cardId: "mc_ok" });
    expect(ok.body.complete.body.status).toBe("completed");
  });

  it("the inspector log joins platform and business records by Request-Id, redacted", async () => {
    const b = new Browser(srv.origin);
    await ready(b);
    const ev = (await b.get("/api/playground/inspector/events")).body.events as any[];
    const ops = ev.map((e) => `${e.actor}:${e.op}`);
    expect(ops).toEqual(expect.arrayContaining(["platform:get_profile", "platform:create_checkout", "business:create_checkout", "platform:update_checkout", "business:update_checkout"]));
    const plat = ev.find((e) => e.actor === "platform" && e.op === "update_checkout");
    const biz = ev.find((e) => e.actor === "business" && e.op === "update_checkout");
    expect(plat.correlationId).toBe(biz.correlationId);
    expect(JSON.stringify(ev)).not.toContain("asha@example.com");
    expect(JSON.stringify(ev)).not.toMatch(/plk_[a-f0-9]{24}/);
    expect(biz.validation[0]).toMatchObject({ target: "response", ok: true });
  });

  it("negotiation fixtures flow through: no-fulfillment platform escalates to the buyer", async () => {
    const b = new Browser(srv.origin);
    await b.post("/api/playground/discovery/fetch", { variant: "no-fulfillment" });
    const c = await b.call("create_checkout", { body: { line_items: [{ item: { id: "var_glide_mouse" }, quantity: 1 }] } });
    expect(c.body.body.status).toBe("requires_escalation");
  });

  it("an unsupported-version platform is rejected by the business, and discovery reports why", async () => {
    const b = new Browser(srv.origin);
    const d = await b.post("/api/playground/discovery/fetch", { variant: "old-version" });
    expect(d.body.error.kind).toBe("version_unsupported");
    const c = await b.call("create_checkout", { body: { line_items: [{ item: { id: "var_glide_mouse" }, quantity: 1 }] } });
    expect(c.status).toBe(409); // no usable client: discovery failed
  });

  it("session reset removes the session's data on both sides", async () => {
    const b = new Browser(srv.origin);
    const co = await ready(b);
    expect((await b.call("get_checkout", { id: co.id })).body.status).toBe(200);
    const r = await b.post("/api/playground/session/reset");
    expect(r.body.ok).toBe(true);
    expect(r.body.removed).toBeGreaterThan(0);
    const after = await b.call("get_checkout", { id: co.id });
    expect(after.body.status).toBe(404);
    const ops = (await b.get("/api/playground/inspector/events")).body.events.map((e: any) => e.op);
    expect(ops).not.toContain("create_checkout"); // everything recorded before the reset is gone
    expect(ops).not.toContain("update_checkout");
  });

  it("the simulator's tokenizer refuses a real-looking number", async () => {
    const b = new Browser(srv.origin);
    await b.post("/api/playground/discovery/fetch", {});
    const r = await b.post("/api/playground/payments/tokenize", { number: "4111111111111111" });
    expect(r.body.status).toBe(422);
    expect(r.body.body.error).toBe("non_test_credential");
    expect(JSON.stringify(r.body)).not.toContain("4111111111111111");
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Recorder, merchantLogKey } from "@/observability/recorder";
import { startServer, store, TestPlatform } from "./env";

let srv: Awaited<ReturnType<typeof startServer>>;
let p: TestPlatform;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(() => srv.close());
// fresh platform (=> isolated data) for every test
import { beforeEach } from "vitest";
beforeEach(() => void (p = new TestPlatform(srv.origin)));

const line = (id: string, quantity = 1) => ({ item: { id }, quantity });
const total = (body: any, type = "total") => body.totals.find((t: any) => t.type === type)?.amount;

describe("create checkout", () => {
  it("201 incomplete with recoverable messages telling the platform what is missing", async () => {
    const r = await p.create({ line_items: [line("var_aurora_anc", 2)] });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("incomplete");
    expect(r.body.currency).toBe("INR");
    const paths = r.body.messages.map((m: any) => m.path);
    expect(paths).toContain("$.buyer.email");
    expect(paths).toContain("$.fulfillment.methods[0].selected_destination_id");
    expect(r.body.messages.every((m: any) => m.severity === "recoverable")).toBe(true);
    expect(total(r.body, "subtotal")).toBe(899800);
    expect(r.body.line_items[0]).toMatchObject({ id: "li_1", quantity: 2, item: { id: "var_aurora_anc", title: expect.any(String), price: 449900 } });
  });
  it("advertises the payment handler in the response with its tokenize endpoint", async () => {
    const r = await p.create({ line_items: [line("var_glide_mouse")] });
    const [name, entries] = Object.entries(r.body.ucp.payment_handlers)[0] as [string, any[]];
    expect(name).toMatch(/mock_tokenizer$/);
    expect(entries[0]).toMatchObject({ id: "mock_tokenizer_1", available_instruments: [{ type: "card" }], config: { simulated: true, tokenize_url: expect.stringContaining("/api/mock-psp/tokenize") } });
  });
  it("echoes only checkout + active extensions (not order/catalog)", async () => {
    const r = await p.create({ line_items: [line("var_glide_mouse")] });
    expect(Object.keys(r.body.ucp.capabilities).sort()).toEqual(["dev.ucp.shopping.checkout", "dev.ucp.shopping.discount", "dev.ucp.shopping.fulfillment"]);
  });
  it("sets a 6-hour expiry, links and a continue_url", async () => {
    const r = await p.create({ line_items: [line("var_glide_mouse")] });
    const ttl = Date.parse(r.body.expires_at) - Date.now();
    expect(ttl).toBeGreaterThan(5.9 * 3600_000);
    expect(ttl).toBeLessThanOrEqual(6 * 3600_000);
    expect(r.body.links.map((l: any) => l.type)).toEqual(expect.arrayContaining(["terms_of_service", "privacy_policy"]));
    expect(r.body.continue_url).toContain(r.body.id);
  });
  it("fully out-of-stock create → 200 error body, no resource (spec example)", async () => {
    const r = await p.create({ line_items: [line("var_nova_lamp_limited")] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ucp: { status: "error" }, messages: [{ code: "out_of_stock", severity: "unrecoverable" }], continue_url: expect.any(String) });
    expect(r.body.id).toBeUndefined();
  });
  it("unknown / delisted items → item_unavailable; over-stock → out_of_stock", async () => {
    expect((await p.create({ line_items: [line("nope")] })).body.messages[0].code).toBe("item_unavailable");
    expect((await p.create({ line_items: [line("var_retro_discman")] })).body.messages[0].code).toBe("item_unavailable");
    expect((await p.create({ line_items: [line("var_studio_monitor_pair", 5)] })).body.messages[0].code).toBe("out_of_stock");
  });
  it("ignores client-supplied prices and titles (merchant-authoritative pricing)", async () => {
    const r = await p.create({ line_items: [{ item: { id: "var_aurora_anc", price: 1, title: "FREE" }, quantity: 1 }] });
    expect(r.status).toBe(201);
    expect(r.body.line_items[0].item.price).toBe(449900);
    expect(r.body.line_items[0].item.title).not.toBe("FREE");
    expect(total(r.body, "subtotal")).toBe(449900);
  });
  it("rejects invalid bodies with JSON paths (quantity 0, empty body)", async () => {
    const r = await p.create({ line_items: [{ item: { id: "var_glide_mouse" }, quantity: 0 }] });
    expect(r.status).toBe(400);
    expect(r.body.messages[0].path).toBe("$.line_items[0].quantity");
    expect((await p.create({})).body.messages[0].path).toBe("$.line_items");
  });
});

describe("update checkout is a FULL REPLACEMENT", () => {
  it("omitted fields are cleared, not merged", async () => {
    const c = await p.create({ line_items: [line("var_aurora_anc")] });
    const withBuyer = await p.update(c.body.id, p.fullUpdate(c.body, { dest: null }));
    expect(withBuyer.body.buyer.email).toBe("asha@example.com");
    // second update forgets the buyer
    const cleared = await p.update(c.body.id, p.fullUpdate(withBuyer.body, { buyer: null, dest: null }));
    expect(cleared.body.buyer).toBeUndefined();
    expect(cleared.body.messages.map((m: any) => m.path)).toContain("$.buyer.email");
  });
  it("walks incomplete → ready_for_complete once buyer, address and shipping option are present", async () => {
    const ready = await p.readyCheckout();
    expect(ready.status).toBe("ready_for_complete");
    expect(ready.messages?.filter((m: any) => m.type === "error") ?? []).toHaveLength(0);
    const g = ready.fulfillment.methods[0].groups[0];
    expect(g.selected_option_id).toBe("standard");
    expect(g.options.map((o: any) => o.id)).toEqual(["standard", "express"]);
    expect(total(ready, "fulfillment")).toBeUndefined(); // ₹4,499 ≥ ₹2,000: standard shipping is free, so no fulfillment total line
    expect(g.options[0].totals[0].amount).toBe(0);
  });
  it("charges standard shipping below the free threshold and express always; the merchant computes it", async () => {
    const std = await p.readyCheckout({ items: [{ id: "var_glide_mouse", quantity: 1 }] }); // ₹999
    expect(total(std, "fulfillment")).toBe(9900);
    const c = await p.create({ line_items: [line("var_glide_mouse")] });
    const exp = await p.update(c.body.id, p.fullUpdate(c.body, { option: "express" }));
    expect(total(exp.body, "fulfillment")).toBe(24900);
    expect(total(exp.body)).toBe(total(exp.body, "subtotal") + total(exp.body, "tax") + 24900);
  });
  it("changing quantity recalculates everything server-side", async () => {
    const ready = await p.readyCheckout({ items: [{ id: "var_glide_mouse", quantity: 1 }] });
    const bigger = await p.update(ready.id, { ...p.fullUpdate(ready), line_items: [{ id: "li_1", item: { id: "var_glide_mouse" }, quantity: 3 }] });
    expect(total(bigger.body, "subtotal")).toBe(3 * 99900);
    expect(bigger.body.line_items[0].quantity).toBe(3);
    expect(total(bigger.body, "fulfillment")).toBeUndefined(); // ₹2,997 ≥ ₹2,000 → free shipping
  });
  it("rejects a quantity beyond stock per line and keeps the previous quantity (recoverable)", async () => {
    const ready = await p.readyCheckout({ items: [{ id: "var_studio_monitor_pair", quantity: 1 }] });
    const r = await p.update(ready.id, { ...p.fullUpdate(ready), line_items: [{ id: "li_1", item: { id: "var_studio_monitor_pair" }, quantity: 9 }] });
    expect(r.status).toBe(200);
    expect(r.body.line_items[0].quantity).toBe(1);
    expect(r.body.messages).toContainEqual(expect.objectContaining({ code: "out_of_stock", severity: "recoverable", path: "$.line_items[0].quantity" }));
  });
  it("unknown line id is a recoverable error", async () => {
    const c = await p.create({ line_items: [line("var_glide_mouse")] });
    const r = await p.update(c.body.id, { line_items: [{ id: "li_99", item: { id: "var_glide_mouse" }, quantity: 1 }] });
    expect(r.body.messages).toContainEqual(expect.objectContaining({ code: "invalid", path: "$.line_items[0].id" }));
    expect(r.body.line_items).toHaveLength(1); // previous lines kept
  });
  it("adds a new line item (no id) and assigns a stable id", async () => {
    const ready = await p.readyCheckout({ items: [{ id: "var_glide_mouse", quantity: 1 }] });
    const r = await p.update(ready.id, { ...p.fullUpdate(ready), line_items: [{ id: "li_1", item: { id: "var_glide_mouse" }, quantity: 1 }, { item: { id: "var_volt_powerbank" }, quantity: 1 }] });
    expect(r.body.line_items.map((l: any) => l.id)).toEqual(["li_1", "li_2"]);
  });
  it("PUT on an unknown checkout → 404 not_found", async () => {
    const r = await p.update("chk_nope", { line_items: [{ item: { id: "var_glide_mouse" }, quantity: 1 }] });
    expect(r.status).toBe(404);
    expect(r.body.messages[0].code).toBe("not_found");
  });
});

describe("fulfillment extension", () => {
  it("rejects undeliverable countries with the standard address_undeliverable error", async () => {
    const c = await p.create({ line_items: [line("var_aurora_anc")] });
    const r = await p.update(c.body.id, p.fullUpdate(c.body, { dest: { type: "shipping_address", id: "dest_1", street_address: "1 Main St", address_locality: "Springfield", address_region: "IL", postal_code: "62701", address_country: "US" } }));
    expect(r.body.status).toBe("incomplete");
    expect(r.body.messages).toContainEqual(expect.objectContaining({ code: "address_undeliverable", severity: "recoverable", path: "$.fulfillment.methods[0].destinations[0].address_country" }));
    expect(r.body.fulfillment.methods[0].groups[0].options).toEqual([]);
  });
  it("validates Indian PIN codes and required address parts", async () => {
    const c = await p.create({ line_items: [line("var_aurora_anc")] });
    const bad = await p.update(c.body.id, p.fullUpdate(c.body, { dest: { type: "shipping_address", id: "dest_1", street_address: "x", address_locality: "y", address_region: "z", postal_code: "12", address_country: "IN" } }));
    expect(bad.body.messages).toContainEqual(expect.objectContaining({ code: "invalid", path: "$.fulfillment.methods[0].destinations[0].postal_code" }));
    const partial = await p.update(c.body.id, p.fullUpdate(c.body, { dest: { type: "shipping_address", id: "dest_1", address_country: "IN" } }));
    expect(partial.body.messages.filter((m: any) => m.code === "missing" && m.path.includes("destinations[0]")).length).toBeGreaterThanOrEqual(3);
  });
  it("assigns destination ids when the platform omits them", async () => {
    const c = await p.create({ line_items: [line("var_aurora_anc")], fulfillment: { methods: [{ type: "shipping", destinations: [{ street_address: "12 MG Road", address_locality: "Bengaluru", address_region: "KA", postal_code: "560001", address_country: "IN" }] }] } });
    expect(c.body.fulfillment.methods[0].destinations[0].id).toBe("dest_1");
  });
  it("rejects an unknown shipping option id", async () => {
    const c = await p.create({ line_items: [line("var_aurora_anc")] });
    const r = await p.update(c.body.id, p.fullUpdate(c.body, { option: "teleport" as never }));
    expect(r.body.messages).toContainEqual(expect.objectContaining({ code: "invalid", path: "$.fulfillment.methods[0].groups[0].selected_option_id" }));
    expect(r.body.status).toBe("incomplete");
  });
});

describe("discount extension", () => {
  it("applies a per-item code, an order-level code and the automatic discount, with allocations", async () => {
    const r = await p.readyCheckout({ items: [{ id: "var_summit_pro_anc", quantity: 2 }], codes: ["WELCOME10", "FLAT500"] });
    expect(r.discounts.codes).toEqual(["WELCOME10", "FLAT500"]);
    const applied = r.discounts.applied;
    expect(applied.map((a: any) => [a.code ?? "auto", a.method])).toEqual([["WELCOME10", "each"], ["FLAT500", "across"], ["auto", "across"]]);
    expect(applied[2].automatic).toBe(true);
    for (const a of applied) expect(a.allocations.reduce((s: number, x: any) => s + x.amount, 0)).toBe(a.amount);
    expect(total(r, "items_discount")).toBe(-applied[0].amount);
    expect(total(r, "discount")).toBe(-(applied[1].amount + applied[2].amount));
    expect(r.line_items[0].totals.map((t: any) => t.type)).toEqual(["subtotal", "items_discount", "total"]);
  });
  it("echoes rejected codes in codes[] but not applied[], with spec warning codes and indexes", async () => {
    const r = await p.readyCheckout({ codes: ["WELCOME10", "SUMMER20", "NOPE"] });
    expect(r.discounts.codes).toEqual(["WELCOME10", "SUMMER20", "NOPE"]);
    expect(r.discounts.applied.map((a: any) => a.code)).toEqual(["WELCOME10"]);
    expect(r.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "warning", code: "discount_code_expired", path: "$.discounts.codes[1]" }),
      expect.objectContaining({ type: "warning", code: "discount_code_invalid", path: "$.discounts.codes[2]" }),
    ]));
    expect(r.status).toBe("ready_for_complete"); // warnings never block
  });
  it("codes have replacement semantics: [] removes them", async () => {
    const withCode = await p.readyCheckout({ codes: ["WELCOME10"] });
    const cleared = await p.update(withCode.id, p.fullUpdate(withCode, { codes: [] }));
    expect(cleared.body.discounts.applied).toEqual([]);
    expect(total(cleared.body, "items_discount")).toBeUndefined();
  });
});

describe("status lifecycle and escalation", () => {
  it("orders above ₹50,000 require buyer review: requires_escalation with continue_url, and Complete is refused", async () => {
    const r = await p.readyCheckout({ items: [{ id: "var_studio_monitor_pair", quantity: 4 }] });
    expect(r.status).toBe("requires_escalation");
    expect(r.messages).toContainEqual(expect.objectContaining({ code: "high_value_order", severity: "requires_buyer_review" }));
    expect(r.continue_url).toContain(r.id);
    const tok = await p.tokenize(r.id, "4242424242424242");
    const c = await p.complete(r.id, p.completeBody(tok.body.token));
    expect(c.status).toBe(200);
    expect(c.body.status).toBe("requires_escalation");
    expect(c.body.order).toBeUndefined();
    expect(c.body.messages).toContainEqual(expect.objectContaining({ code: "checkout_not_ready", severity: "recoverable" }));
  });
  it("Complete on an incomplete checkout returns it unchanged with checkout_not_ready", async () => {
    const c = await p.create({ line_items: [line("var_glide_mouse")] });
    const tok = await p.tokenize(c.body.id, "4242424242424242");
    const r = await p.complete(c.body.id, p.completeBody(tok.body.token));
    expect(r.body.status).toBe("incomplete");
    expect(r.body.messages).toContainEqual(expect.objectContaining({ code: "checkout_not_ready" }));
  });
  it("cancel → canceled; cancel again, update and complete are refused with 409 invalid_state; GET still works", async () => {
    const c = await p.create({ line_items: [line("var_glide_mouse")] });
    const x = await p.cancel(c.body.id);
    expect(x.status).toBe(200);
    expect(x.body.status).toBe("canceled");
    expect((await p.cancel(c.body.id)).status).toBe(409);
    expect((await p.update(c.body.id, { line_items: [{ id: "li_1", item: { id: "var_glide_mouse" }, quantity: 1 }] })).status).toBe(409);
    expect((await p.complete(c.body.id, p.completeBody("tok_x"))).status).toBe(409);
    expect((await p.get(c.body.id)).body.status).toBe("canceled");
  });
  it("a checkout past expires_at reads as canceled", async () => {
    const c = await p.create({ line_items: [line("var_glide_mouse")] });
    const key = `m:${p.platformId}:co:${c.body.id}`;
    const rec = await store().get<any>(key);
    await store().set(key, { ...rec, expiresAt: Date.now() - 1000 });
    const r = await p.get(c.body.id);
    expect(r.body.status).toBe("canceled");
    expect((await p.update(c.body.id, { line_items: [] })).status).toBe(409);
  });
});

describe("authentication and tenancy", () => {
  it("checkout requires a platform credential", async () => {
    const r = await p.call("POST", "/api/ucp/v1/checkout-sessions", { line_items: [line("var_glide_mouse")] }, {}, { key: false });
    expect(r.status).toBe(401);
    expect(r.body.messages[0].code).toBe("unauthorized");
    const bad = await p.call("POST", "/api/ucp/v1/checkout-sessions", { line_items: [line("var_glide_mouse")] }, { "x-api-key": "plk_deadbeef.zzzz" });
    expect(bad.status).toBe(401);
  });
  it("another platform cannot read, change or cancel my checkout", async () => {
    const c = await p.create({ line_items: [line("var_glide_mouse")] });
    const other = new TestPlatform(srv.origin);
    expect((await other.get(c.body.id)).status).toBe(404);
    expect((await other.update(c.body.id, { line_items: [{ id: "li_1", item: { id: "var_glide_mouse" }, quantity: 1 }] })).status).toBe(404);
    expect((await other.cancel(c.body.id)).status).toBe(404);
  });
});

describe("the business logs every call, redacted", () => {
  it("records business-side interactions without credentials or PII", async () => {
    const r = await p.readyCheckout();
    const log = await new Recorder(store(), merchantLogKey).list(p.platformId);
    expect(log.length).toBeGreaterThanOrEqual(2);
    const upd = log.find((l) => l.op === "update_checkout")!;
    expect(upd.requestHeaders["x-api-key"]).toBe("[REDACTED]");
    expect(JSON.stringify(upd)).not.toContain("asha@example.com");
    expect(upd).toMatchObject({ actor: "business", method: "PUT", status: 200, correlationId: expect.any(String) });
    expect(upd.validation[0]).toMatchObject({ ok: true });
    expect(r.id).toBeDefined();
  });
});

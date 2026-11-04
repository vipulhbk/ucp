import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Recorder, merchantLogKey } from "@/observability/recorder";
import { orderIndexKey } from "@/merchant/orders/orders";
import { OrderSchema } from "@/ucp/schemas";
import { startServer, store, TestPlatform } from "./env";

let srv: Awaited<ReturnType<typeof startServer>>;
let p: TestPlatform;
beforeAll(async () => void (srv = await startServer()));
afterAll(() => srv.close());
beforeEach(() => void (p = new TestPlatform(srv.origin)));

describe("successful purchase (Scenario 2 protocol)", () => {
  it("tokenize → complete → completed with an order; Get Order returns the full entity", async () => {
    const ready = await p.readyCheckout({ items: [{ id: "var_aurora_anc", quantity: 2 }], codes: ["WELCOME10"] });
    expect(ready.status).toBe("ready_for_complete");

    const done = await p.pay(ready.id);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("completed");
    expect(done.body.order).toMatchObject({ id: expect.stringMatching(/^ord_/), permalink_url: expect.stringContaining("/orders/ord_") });
    expect(done.body.payment.instruments[0]).toMatchObject({ handler_id: "mock_tokenizer_1", type: "card", selected: true, display: { brand: "visa", last4: "4242" } });
    expect(done.body.payment.instruments[0].credential).toBeUndefined(); // credentials are never echoed

    const ord = await p.order(done.body.order.id);
    expect(ord.status).toBe(200);
    expect(OrderSchema.safeParse(ord.body).success).toBe(true);
    expect(ord.body).toMatchObject({ checkout_id: ready.id, currency: "INR", label: done.body.order.label, line_items: [{ quantity: { original: 2, total: 2, fulfilled: 0 }, status: "processing" }] });
    expect(ord.body.totals).toEqual(done.body.totals); // the order carries the totals the buyer authorized
    expect(Object.keys(ord.body.ucp.capabilities)).toEqual(["dev.ucp.shopping.order"]);
    expect(ord.body.fulfillment.expectations[0]).toMatchObject({ method_type: "shipping", destination: { postal_code: "560001" } });
    expect(ord.body.fulfillment.events).toEqual([]);
  });
  it("a completed checkout cannot be modified, completed again, or canceled", async () => {
    const ready = await p.readyCheckout();
    const done = await p.pay(ready.id);
    expect(done.body.status).toBe("completed");
    expect((await p.update(ready.id, p.fullUpdate(ready))).status).toBe(409);
    expect((await p.pay(ready.id)).status).toBe(409);
    expect((await p.cancel(ready.id)).status).toBe(409);
    expect((await p.get(ready.id)).body.status).toBe("completed");
  });
  it("Get Order for an unknown id → 404 not_found (unrecoverable); another platform cannot read my order", async () => {
    const ready = await p.readyCheckout();
    const done = await p.pay(ready.id);
    const miss = await p.order("ord_nope");
    expect(miss.status).toBe(404);
    expect(miss.body).toMatchObject({ ucp: { status: "error" }, messages: [{ code: "not_found", severity: "unrecoverable" }] });
    expect((await new TestPlatform(srv.origin).order(done.body.order.id)).status).toBe(404);
    expect((await p.call("GET", `/api/ucp/v1/orders/${done.body.order.id}`, undefined, {}, { key: false })).status).toBe(401);
  });
});

describe("payment failure and retry (Scenario 4 protocol)", () => {
  it("declined card → payment_failed (recoverable) and status incomplete; then a new instrument succeeds", async () => {
    const ready = await p.readyCheckout();
    const bad = await p.pay(ready.id, "4000000000000002");
    expect(bad.status).toBe(200);
    expect(bad.body.status).toBe("incomplete");
    expect(bad.body.order).toBeUndefined();
    expect(bad.body.messages).toContainEqual(expect.objectContaining({ type: "error", code: "payment_failed", severity: "recoverable", path: "$.payment.instruments[0]" }));

    // still incomplete on read; the platform resolves it through Update (spec: resolve recoverable errors via Update Checkout)
    expect((await p.get(ready.id)).body.status).toBe("incomplete");
    const fixed = await p.update(ready.id, p.fullUpdate(bad.body));
    expect(fixed.body.status).toBe("ready_for_complete");
    expect(fixed.body.messages?.some((m: any) => m.code === "payment_failed")).toBeFalsy();

    const ok = await p.pay(ready.id, "5555555555554444"); // a NEW operation → fresh Idempotency-Key
    expect(ok.body.status).toBe("completed");
    expect(ok.body.payment.instruments[0].display.brand).toBe("mastercard");
  });
  it("insufficient funds is also a recoverable payment_failed", async () => {
    const ready = await p.readyCheckout();
    const r = await p.pay(ready.id, "4000000000009995");
    expect(r.body.messages).toContainEqual(expect.objectContaining({ code: "payment_failed", content: expect.stringContaining("Insufficient") }));
  });
  it("a failed payment creates no order", async () => {
    const ready = await p.readyCheckout();
    await p.pay(ready.id, "4000000000000002");
    expect(await store().listRange(orderIndexKey(p.platformId))).toEqual([]);
  });
  it("same declined token can be retried but the decline repeats (no side effects)", async () => {
    const ready = await p.readyCheckout();
    const tok = await p.tokenize(ready.id, "4000000000000002");
    const a = await p.complete(ready.id, p.completeBody(tok.body.token));
    await p.update(ready.id, p.fullUpdate(a.body));
    const b = await p.complete(ready.id, p.completeBody(tok.body.token));
    expect(b.body.messages).toContainEqual(expect.objectContaining({ code: "payment_failed" }));
  });
});

describe("asynchronous completion (complete_in_progress)", () => {
  it("accepts completion without an order, blocks Update/Complete, and settles on Get Checkout", async () => {
    const ready = await p.readyCheckout();
    const accepted = await p.pay(ready.id, "4000000000003220");
    expect(accepted.body.status).toBe("complete_in_progress");
    expect(accepted.body.order).toBeUndefined(); // spec: MUST NOT contain order

    const upd = await p.update(ready.id, p.fullUpdate(accepted.body));
    expect(upd.status).toBe(200);
    expect(upd.body.status).toBe("complete_in_progress"); // unchanged
    expect(upd.body.messages).toContainEqual(expect.objectContaining({ code: "checkout_update_not_allowed", severity: "recoverable" }));

    const again = await p.complete(ready.id, p.completeBody("tok_other"));
    expect(again.body.status).toBe("complete_in_progress");
    expect(again.body.messages).toContainEqual(expect.objectContaining({ code: "checkout_complete_not_allowed" }));

    const settled = await p.get(ready.id);
    expect(settled.body.status).toBe("completed");
    expect(settled.body.order.id).toMatch(/^ord_/);
    expect((await p.order(settled.body.order.id)).status).toBe(200);
    expect(await store().listRange(orderIndexKey(p.platformId))).toHaveLength(1);
  });
  it("an in-progress checkout can still be canceled", async () => {
    const ready = await p.readyCheckout();
    await p.pay(ready.id, "4000000000003220");
    const r = await p.cancel(ready.id);
    expect(r.body.status).toBe("canceled");
  });
});

describe("payment security", () => {
  it("tokenizer refuses real-looking card numbers and never echoes or stores them", async () => {
    const ready = await p.readyCheckout();
    const r = await p.tokenize(ready.id, "4111111111111111");
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ error: "non_test_credential", simulated: true });
    expect(r.text).not.toContain("4111");
    expect(JSON.stringify(await store().listRange(`m:${p.platformId}:log`))).not.toContain("4111111111111111");
  });
  it("tokenizer requires the platform credential", async () => {
    const res = await fetch(`${srv.origin}/api/mock-psp/tokenize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential: { type: "pan", number: "4242424242424242" }, binding: { type: "x", id: "y" } }) });
    expect(res.status).toBe(401);
  });
  it("Complete refuses a raw PAN credential (must be a token) and the number is not logged", async () => {
    const ready = await p.readyCheckout();
    const body = { payment: { instruments: [{ id: "i1", handler_id: "mock_tokenizer_1", type: "card", credential: { type: "pan", number: "4242424242424242" } }] } };
    const r = await p.complete(ready.id, body);
    expect(r.body.status).toBe("incomplete");
    expect(r.body.messages).toContainEqual(expect.objectContaining({ code: "invalid_credential_type" }));
    expect(r.text).not.toContain("4242424242424242");
    const log = await new Recorder(store(), merchantLogKey).list(p.platformId);
    expect(JSON.stringify(log)).not.toContain("4242424242424242");
  });
  it("a token bound to a different checkout is rejected (binding replay guard)", async () => {
    const a = await p.readyCheckout();
    const b = await p.readyCheckout();
    const tokForA = await p.tokenize(a.id, "4242424242424242");
    const r = await p.complete(b.id, p.completeBody(tokForA.body.token));
    expect(r.body.status).toBe("incomplete");
    expect(r.body.messages).toContainEqual(expect.objectContaining({ code: "payment_failed", content: expect.stringContaining("different resource") }));
  });
  it("unknown payment handler id and unsupported instrument types are recoverable errors", async () => {
    const ready = await p.readyCheckout();
    const tok = await p.tokenize(ready.id, "4242424242424242");
    const h = await p.complete(ready.id, p.completeBody(tok.body.token, "gpay_1234"));
    expect(h.body.messages).toContainEqual(expect.objectContaining({ code: "payment_handler_unsupported" }));
    await p.update(ready.id, p.fullUpdate(h.body));
    const t = await p.complete(ready.id, { payment: { instruments: [{ id: "i", handler_id: "mock_tokenizer_1", type: "bank_transfer", credential: { type: "token", token: tok.body.token } }] } });
    expect(t.body.messages).toContainEqual(expect.objectContaining({ code: "payment_instrument_unsupported" }));
  });
  it("Complete without payment.instruments fails schema validation with a path", async () => {
    const ready = await p.readyCheckout();
    const r = await p.complete(ready.id, {});
    expect(r.status).toBe(400);
    expect(r.body.messages[0].path).toBe("$.payment");
  });
});

describe("idempotency (Idempotency-Key)", () => {
  it("replays the stored response for the same key + same payload, without a second order", async () => {
    const ready = await p.readyCheckout();
    const tok = await p.tokenize(ready.id, "4242424242424242");
    const key = randomUUID();
    const body = p.completeBody(tok.body.token);
    const first = await p.complete(ready.id, body, { "idempotency-key": key });
    const replay = await p.complete(ready.id, body, { "idempotency-key": key });
    expect(first.body.status).toBe("completed");
    expect(replay.status).toBe(first.status);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(first.headers.get("idempotent-replayed")).toBeNull();
    expect(await store().listRange(orderIndexKey(p.platformId))).toHaveLength(1);
  });
  it("same key with a different payload → 409 idempotency_conflict", async () => {
    const c = await p.create({ line_items: [{ item: { id: "var_glide_mouse" }, quantity: 1 }] });
    const key = randomUUID();
    const a = await p.update(c.body.id, p.fullUpdate(c.body), { "idempotency-key": key });
    expect(a.status).toBe(200);
    const b = await p.update(c.body.id, { ...p.fullUpdate(c.body), buyer: { email: "other@example.com" } }, { "idempotency-key": key });
    expect(b.status).toBe(409);
    expect(b.body.messages[0].code).toBe("idempotency_conflict");
  });
  it("the same key on a different path is also a conflict", async () => {
    const key = randomUUID();
    const a = await p.create({ line_items: [{ item: { id: "var_glide_mouse" }, quantity: 1 }] }, { "idempotency-key": key });
    const b = await p.cancel(a.body.id).then(() => p.call("POST", `/api/ucp/v1/checkout-sessions/${a.body.id}/cancel`, undefined, { "idempotency-key": key }));
    expect(b.status).toBe(409);
  });
  it("is required on state-changing calls and must be a UUID", async () => {
    const body = { line_items: [{ item: { id: "var_glide_mouse" }, quantity: 1 }] };
    expect((await p.create(body, { "idempotency-key": null })).status).toBe(400);
    expect((await p.create(body, { "idempotency-key": "not-a-uuid" })).status).toBe(400);
  });
  it("create with a repeated key returns the SAME checkout, not a second one", async () => {
    const key = randomUUID();
    const body = { line_items: [{ item: { id: "var_glide_mouse" }, quantity: 1 }] };
    const a = await p.create(body, { "idempotency-key": key });
    const b = await p.create(body, { "idempotency-key": key });
    expect(b.body.id).toBe(a.body.id);
  });
  it("concurrent duplicate Completes yield exactly one order", async () => {
    const ready = await p.readyCheckout();
    const tok = await p.tokenize(ready.id, "4242424242424242");
    const key = randomUUID();
    const body = p.completeBody(tok.body.token);
    const rs = await Promise.all(Array.from({ length: 5 }, () => p.complete(ready.id, body, { "idempotency-key": key })));
    expect(new Set(rs.map((r) => r.body.order?.id)).size).toBe(1);
    expect(await store().listRange(orderIndexKey(p.platformId))).toHaveLength(1);
  });
  it("concurrent Completes with DIFFERENT keys cannot double-order the same checkout", async () => {
    const ready = await p.readyCheckout();
    const toks = await Promise.all([1, 2, 3].map(() => p.tokenize(ready.id, "4242424242424242")));
    const rs = await Promise.all(toks.map((t) => p.complete(ready.id, p.completeBody(t.body.token))));
    expect(rs.filter((r) => r.body.status === "completed" && r.status === 200)).toHaveLength(1);
    expect(await store().listRange(orderIndexKey(p.platformId))).toHaveLength(1);
  });
});

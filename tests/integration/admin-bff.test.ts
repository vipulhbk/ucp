import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, startServer } from "./env";

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => void (srv = await startServer()));
afterAll(() => srv.close());

const addr = { type: "shipping_address", id: "dest_1", street_address: "12 MG Road", address_locality: "Bengaluru", address_region: "KA", postal_code: "560001", address_country: "IN" };

/** Full purchase through the playground BFF (the platform's own path, including the ownership hook). */
async function purchase(b: Browser) {
  await b.post("/api/playground/discovery/fetch", {});
  const created = (await b.call("create_checkout", { body: { line_items: [{ item: { id: "var_aurora_anc" }, quantity: 1 }] } })).body.body;
  const upd = await b.call("update_checkout", { id: created.id, body: { line_items: [{ id: "li_1", item: { id: "var_aurora_anc" }, quantity: 1 }], buyer: { email: "a@example.com" }, fulfillment: { methods: [{ id: "method_1", type: "shipping", line_item_ids: ["li_1"], destinations: [addr], selected_destination_id: "dest_1", groups: [{ id: "group_1", selected_option_id: "standard" }] }] } } });
  await b.post("/api/playground/checkout/consent", { checkoutId: created.id, cardId: "visa_ok", expectedTotal: upd.body.body.totals.find((t: any) => t.type === "total").amount });
  const done = await b.post("/api/playground/checkout/complete", { checkoutId: created.id, cardId: "visa_ok" });
  return done.body.complete.body.order.id as string;
}
const settle = async (b: Browser) => {
  // webhook delivery runs after the response; poll the console like the UI does
  for (let i = 0; i < 40; i++) {
    const s = (await b.get("/api/playground/webhooks")).body;
    if (s.outbox.length && s.outbox.every((r: { status: string }) => r.status !== "pending") && s.receipts.every((r: { outcome: string }) => r.outcome !== "pending")) return s;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("webhooks did not settle");
};

describe("merchant dashboard + admin console + webhook inspector (BFF, real delivery over HTTP)", () => {
  it("a completed purchase appears in the dashboard and its 'Order created' webhook reaches the platform", async () => {
    const b = new Browser(srv.origin);
    const id = await purchase(b);
    const list = (await b.get("/api/playground/orders")).body.orders;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, actions: ["ship", "cancel"], entity: { id, currency: "INR" } });
    const s = await settle(b);
    expect(s.outbox[0]).toMatchObject({ summary: "Order created", status: "delivered", body: { id } });
    expect(s.receipts[0]).toMatchObject({ verified: true, outcome: "applied", alg: "ES256" });
    expect(s.snapshots[0].orderId).toBe(id);
  });
  it("admin actions flow end to end: ship → deliver → return → refund, each a signed webhook the platform applies", async () => {
    const b = new Browser(srv.origin);
    const id = await purchase(b);
    for (const action of ["ship", "deliver", "return", "refund"]) {
      const r = await b.post(`/api/playground/orders/${id}/action`, { action });
      expect(r.status, action).toBe(200);
      await settle(b);
    }
    const s = (await b.get("/api/playground/webhooks")).body;
    expect(s.outbox.map((r: { summary: string }) => r.summary).reverse()).toEqual(["Order created", "Shipped", "Delivered", "Returned", "Refunded"]);
    expect(s.outbox.every((r: { status: string }) => r.status === "delivered")).toBe(true);
    expect(s.receipts.filter((r: { outcome: string }) => r.outcome === "applied")).toHaveLength(5);
    const snap = s.snapshots[0].order;
    expect(snap.adjustments.map((a: { type: string }) => a.type)).toEqual(["return", "refund"]);
    expect(snap.fulfillment.events.map((e: { type: string }) => e.type)).toEqual(["shipped", "delivered"]);
    const got = await b.call("get_order", { id });
    expect(got.body.body).toEqual(snap); // platform state == business state
  });
  it("invalid admin actions return 409; unknown orders 404; bad input 400", async () => {
    const b = new Browser(srv.origin);
    const id = await purchase(b);
    expect((await b.post(`/api/playground/orders/${id}/action`, { action: "refund" })).status).toBe(409);
    expect((await b.post(`/api/playground/orders/ord_nope/action`, { action: "ship" })).status).toBe(404);
    expect((await b.post(`/api/playground/orders/${id}/action`, { action: "explode" })).status).toBe(400);
  });
  it("security demonstrations are rejected by the platform and shown in the receipts", async () => {
    const b = new Browser(srv.origin);
    await purchase(b);
    const s0 = await settle(b);
    const rowId = s0.outbox[0].id;
    const expected: Record<string, string> = { tamper_body: "digest_mismatch", bad_signature: "signature_invalid", unknown_key: "key_not_found", stale_timestamp: "webhook_timestamp_invalid", wrong_signer: "signer_not_order_business" };
    for (const [mode, reason] of Object.entries(expected)) {
      const r = await b.post("/api/playground/webhooks/send", { rowId, mode });
      expect(r.body.attempt.ok, mode).toBe(false);
      expect(JSON.stringify(r.body.attempt.ack), mode).toContain(reason);
    }
    const s = (await b.get("/api/playground/webhooks")).body;
    expect(s.receipts.filter((r: { outcome: string }) => r.outcome === "rejected").map((r: { reason: string }) => r.reason).sort()).toEqual(Object.values(expected).sort());
    expect(s.snapshots).toHaveLength(1);
    expect(s.snapshots[0].history).toHaveLength(1); // only the genuine delivery was ever applied
  });
  it("duplicate redelivery is acknowledged and applied once", async () => {
    const b = new Browser(srv.origin);
    await purchase(b);
    const s0 = await settle(b);
    const r = await b.post("/api/playground/webhooks/send", { rowId: s0.outbox[0].id, mode: "redeliver" });
    expect(r.body.attempt).toMatchObject({ ok: true, status: 200 });
    const s = (await b.get("/api/playground/webhooks")).body;
    expect(s.receipts.filter((x: { duplicate: boolean }) => x.duplicate)).toHaveLength(1);
    expect(s.snapshots[0].history).toHaveLength(1);
  });
  it("the stored webhook body is shown exactly as sent (and contains no raw PII/credentials)", async () => {
    const b = new Browser(srv.origin);
    await purchase(b);
    const s = await settle(b);
    const text = JSON.stringify(s.outbox);
    expect(text).not.toMatch(/tok_[A-Za-z0-9_-]{10,}/);
    expect(text).not.toContain("4242424242424242");
  });
  it("session reset removes orders, outbox, receipts and snapshots on both sides", async () => {
    const b = new Browser(srv.origin);
    await purchase(b);
    await settle(b);
    await b.post("/api/playground/session/reset");
    expect((await b.get("/api/playground/orders")).body.orders).toEqual([]);
    const s = (await b.get("/api/playground/webhooks")).body;
    expect(s.outbox).toEqual([]);
    expect(s.receipts).toEqual([]);
    expect(s.snapshots).toEqual([]);
  });
});

describe("cron retry driver", () => {
  it("is disabled without CRON_SECRET and requires the bearer secret when enabled", async () => {
    delete process.env.CRON_SECRET;
    expect((await fetch(`${srv.origin}/api/cron/webhooks`)).status).toBe(404);
    process.env.CRON_SECRET = "s3cr3t-cron";
    try {
      expect((await fetch(`${srv.origin}/api/cron/webhooks`)).status).toBe(401);
      expect((await fetch(`${srv.origin}/api/cron/webhooks`, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
      const ok = await fetch(`${srv.origin}/api/cron/webhooks`, { headers: { authorization: "Bearer s3cr3t-cron" } });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toHaveProperty("attempted");
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});

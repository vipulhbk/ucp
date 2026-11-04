import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { captureDeferred, defer } from "@/lib/defer";
import { getConfig } from "@/config";
import { applyAction, availableActions } from "@/merchant/orders/events";
import { loadOrder } from "@/merchant/orders/orders";
import { ATTACK_KINDS, deliver, flush, listRows, sendExtra, type OutboxDeps } from "@/merchant/webhooks/outbox";
import { getMerchantSigningKey } from "@/merchant/signing-key";
import { listReceipts, listSnapshots } from "@/platform/orders";
import { OrderSchema } from "@/ucp/schemas";
import { startServer, store, TestPlatform } from "./env";

let srv: Awaited<ReturnType<typeof startServer>>;
let p: TestPlatform;
let cap: ReturnType<typeof captureDeferred>;
beforeAll(async () => void (srv = await startServer()));
afterAll(() => srv.close());
beforeEach(() => {
  p = new TestPlatform(srv.origin);
  cap = captureDeferred();
});

const deps = (over: Partial<OutboxDeps> = {}): OutboxDeps => ({ store: store(), origin: srv.origin, signingKey: getMerchantSigningKey(), allowedOrigins: [srv.origin], devLoopbackHosts: getConfig().devLoopbackHosts, now: Date.now, ...over });
const mctx = () => ({ store: store(), platformId: p.platformId, origin: srv.origin, now: Date.now, defer });

/** Place an order; deliveries are captured, so tests control when webhooks go out. */
async function placeOrder(items = [{ id: "var_aurora_anc", quantity: 2 }]) {
  const ready = await p.readyCheckout({ items });
  const done = await p.pay(ready.id);
  return { orderId: done.body.order.id as string, checkoutId: ready.id as string };
}
const rows = () => listRows(store(), p.platformId);
const receipts = () => listReceipts(store(), p.platformId);
const snapshot = async (orderId: string) => (await listSnapshots(store(), p.platformId)).find((s) => s.order.id === orderId);
const act = (orderId: string, action: Parameters<typeof applyAction>[2]) => applyAction(mctx(), orderId, action);

describe("order created → signed webhook → platform", () => {
  it("queues the full order entity on creation and delivers it once Complete's response has gone out", async () => {
    const { orderId } = await placeOrder();
    const queued = await rows();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ summary: "Order created", status: "pending", orderId, webhookUrl: p.webhookUrl });
    expect(await snapshot(orderId)).toBeUndefined(); // nothing delivered yet: delivery runs after the response

    await cap.drain();
    const [row] = await rows();
    expect(row).toMatchObject({ status: "delivered" });
    expect(row!.attempts).toHaveLength(1);
    expect(row!.attempts[0]).toMatchObject({ ok: true, status: 200, ack: { ucp: { version: "2026-08-25" } } });
  });
  it("the platform verified an ES256 signature against the key in the business's published profile", async () => {
    const { orderId } = await placeOrder();
    await cap.drain();
    const [r] = await receipts();
    expect(r).toMatchObject({ verified: true, outcome: "applied", orderId, alg: "ES256", signerProfileUrl: p.businessProfileUrl, httpStatus: 200, duplicate: false });
    expect(r!.keyid).toBe(getMerchantSigningKey().kid);
    expect(r!.headers["content-digest"]).toMatch(/^sha-256=:/);
    expect(r!.headers["signature-input"]).toContain('"webhook-id"');
  });
  it("the delivered snapshot is the same entity Get Order returns (full current state, not a delta)", async () => {
    const { orderId } = await placeOrder();
    await cap.drain();
    const got = await p.order(orderId);
    const snap = await snapshot(orderId);
    expect(OrderSchema.safeParse(snap!.order).success).toBe(true);
    expect(snap!.order).toEqual(got.body);
  });
  it("sends no webhook when the platform advertised no order capability / webhook_url", async () => {
    const q = new TestPlatform(srv.origin, "no-order");
    const ready = await q.readyCheckout();
    const done = await q.pay(ready.id);
    expect(done.body.status).toBe("completed");
    await cap.drain();
    expect(await listRows(store(), q.platformId)).toEqual([]);
    expect((await q.order(done.body.order.id)).body.messages[0].code).toBe("capabilities_incompatible");
  });
  it("is not delivered to a webhook_url outside the allowlist (SSRF) and the attempt records why", async () => {
    const { orderId } = await placeOrder();
    const [row] = await rows();
    await store().set(`m:${p.platformId}:ox:${row!.id}`, { ...row, webhookUrl: "https://evil.example/hook" });
    const r = await deliver(deps(), p.platformId, row!.id, { force: true });
    expect(r!.attempts.at(-1)).toMatchObject({ ok: false, error: expect.stringContaining("not_allowlisted") });
    expect(orderId).toBeDefined();
  });
});

describe("order events and adjustments (merchant admin → new snapshot → webhook)", () => {
  it("ship → deliver: events are append-only, quantities/status follow the spec formula, each change is pushed", async () => {
    const { orderId } = await placeOrder();
    await cap.drain();
    expect((await act(orderId, "ship")).ok).toBe(true);
    let o = (await p.order(orderId)).body;
    expect(o.fulfillment.events).toHaveLength(1);
    expect(o.fulfillment.events[0]).toMatchObject({ type: "shipped", line_items: [{ id: "li_1", quantity: 2 }], carrier: expect.any(String), tracking_number: expect.any(String) });
    expect(o.line_items[0]).toMatchObject({ status: "processing", quantity: { original: 2, total: 2, fulfilled: 0 } });

    await act(orderId, "deliver");
    o = (await p.order(orderId)).body;
    expect(o.fulfillment.events.map((e: { type: string }) => e.type)).toEqual(["shipped", "delivered"]);
    expect(o.line_items[0]).toMatchObject({ status: "fulfilled", quantity: { total: 2, fulfilled: 2 } });
    expect(OrderSchema.safeParse(o).success).toBe(true);

    await cap.drain();
    expect((await rows()).map((r) => [r.summary, r.status])).toEqual([["Order created", "delivered"], ["Shipped", "delivered"], ["Delivered", "delivered"]]);
    expect((await snapshot(orderId))!.order).toEqual(o); // platform converged on the latest state
  });
  it("cancel before shipment: adjustment, line removed, original quantity preserved; then refund", async () => {
    const { orderId } = await placeOrder();
    expect((await act(orderId, "cancel")).ok).toBe(true);
    let o = (await p.order(orderId)).body;
    expect(o.adjustments[0]).toMatchObject({ type: "cancellation", status: "completed", line_items: [{ id: "li_1", quantity: -2 }] });
    expect(o.adjustments[0].totals[0].amount).toBeLessThan(0);
    expect(o.line_items[0]).toMatchObject({ status: "removed", quantity: { original: 2, total: 0 } });
    await act(orderId, "refund");
    o = (await p.order(orderId)).body;
    expect(o.adjustments.map((a: { type: string }) => a.type)).toEqual(["cancellation", "refund"]);
    expect(OrderSchema.safeParse(o).success).toBe(true);
  });
  it("return after delivery, then refund", async () => {
    const { orderId } = await placeOrder();
    await act(orderId, "ship");
    await act(orderId, "deliver");
    expect((await act(orderId, "return")).ok).toBe(true);
    expect((await act(orderId, "refund")).ok).toBe(true);
    const o = (await p.order(orderId)).body;
    expect(o.adjustments.map((a: { type: string }) => a.type)).toEqual(["return", "refund"]);
    expect(o.adjustments[0].line_items[0].quantity).toBe(-2);
  });
  it("rejects actions that make no sense in the current state", async () => {
    const { orderId } = await placeOrder();
    const bad = async (a: Parameters<typeof applyAction>[2]) => expect(await act(orderId, a), a).toMatchObject({ ok: false, code: "invalid_state" });
    await bad("deliver"); // nothing shipped
    await bad("return"); // nothing delivered
    await bad("refund"); // nothing to refund
    await act(orderId, "ship");
    await bad("ship"); // all shipped already
    await bad("cancel"); // too late
    await act(orderId, "deliver");
    await act(orderId, "return");
    await bad("return");
    expect(await act("ord_missing", "ship")).toMatchObject({ ok: false, code: "not_found" });
  });
  it("availableActions mirrors what the state machine permits", async () => {
    const { orderId } = await placeOrder();
    const rec = async () => (await loadOrder(store(), p.platformId, orderId))!;
    expect(availableActions(await rec())).toEqual(["ship", "cancel"]);
    await act(orderId, "ship");
    expect(availableActions(await rec())).toEqual(["deliver"]);
    await act(orderId, "deliver");
    expect(availableActions(await rec())).toEqual(["return"]);
  });
  it("another platform's admin cannot touch my order", async () => {
    const { orderId } = await placeOrder();
    const other = { ...mctx(), platformId: new TestPlatform(srv.origin).platformId };
    expect(await applyAction(other, orderId, "ship")).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("idempotent, out-of-order and replayed deliveries", () => {
  it("a duplicate delivery (same Webhook-Id) is acknowledged and has no effect", async () => {
    const { orderId } = await placeOrder();
    await cap.drain();
    const [row] = await rows();
    const dup = await sendExtra(deps(), p.platformId, row!.id, "redeliver");
    expect(dup!.attempt).toMatchObject({ ok: true, status: 200 });
    const rs = await receipts();
    expect(rs.filter((r) => r.duplicate)).toHaveLength(1);
    expect(rs.find((r) => r.duplicate)).toMatchObject({ outcome: "duplicate", webhookId: row!.id });
    expect((await snapshot(orderId))!.history).toHaveLength(1); // applied exactly once
    expect((await rows())[0]!.status).toBe("delivered"); // redelivery does not disturb row state
  });
  it("redeliveries do not count toward the retry limit", async () => {
    await placeOrder();
    await cap.drain();
    const [row] = await rows();
    for (let i = 0; i < 8; i++) await sendExtra(deps(), p.platformId, row!.id, "redeliver");
    expect((await rows())[0]!.status).toBe("delivered");
  });
  it("an older event arriving after a newer one is recorded but does not overwrite state", async () => {
    const { orderId } = await placeOrder();
    await act(orderId, "ship");
    const queued = await rows(); // oldest first: [created, shipped]
    const T = Date.now();
    await deliver(deps({ now: () => T + 10_000 }), p.platformId, queued[1]!.id, { force: true }); // newer first
    await deliver(deps({ now: () => T }), p.platformId, queued[0]!.id, { force: true }); // older second
    await cap.drain(); // the platform acks first and applies asynchronously
    const snap = (await snapshot(orderId))!;
    expect((snap.order.fulfillment as { events: unknown[] }).events).toHaveLength(1); // the shipped state survived
    expect(snap.history.map((h) => h.applied)).toEqual([true, false]);
    expect((await receipts()).map((r) => r.outcome).sort()).toEqual(["applied", "stale_ignored"]);
  });
});

describe("the platform rejects forged, tampered and misdirected webhooks", () => {
  const cases: [string, number, string][] = [
    ["tamper_body", 400, "digest_mismatch"],
    ["bad_signature", 401, "signature_invalid"],
    ["unknown_key", 401, "key_not_found"],
    ["stale_timestamp", 400, "webhook_timestamp_invalid"],
    ["wrong_signer", 403, "signer_not_order_business"],
  ];
  it.each(cases)("%s → HTTP %i %s, recorded as rejected, state untouched", async (mode, status, reason) => {
    const { orderId } = await placeOrder();
    const [row] = await rows();
    const r = await sendExtra(deps(), p.platformId, row!.id, mode as never);
    expect(r!.attempt).toMatchObject({ ok: false, status, attack: mode });
    expect(JSON.stringify(r!.attempt.ack)).toContain(reason);
    const rej = (await receipts()).find((x) => x.outcome === "rejected");
    expect(rej).toMatchObject({ verified: false, reason, httpStatus: status, duplicate: false });
    expect(await snapshot(orderId)).toBeUndefined();
  });
  it("covers every attack kind the console offers", () => expect(cases.map((c) => c[0]).sort()).toEqual([...ATTACK_KINDS].sort()));
  it("a rejected attempt never consumes the Webhook-Id: the genuine delivery still applies afterwards", async () => {
    const { orderId } = await placeOrder();
    const [row] = await rows();
    for (const k of ATTACK_KINDS) await sendExtra(deps(), p.platformId, row!.id, k);
    expect((await receipts()).every((r) => r.outcome === "rejected")).toBe(true);
    await cap.drain();
    expect((await snapshot(orderId))).toBeDefined();
    expect((await receipts()).find((r) => r.outcome === "applied")).toMatchObject({ webhookId: row!.id });
  });
  it("rejected deliveries do not change the row's real delivery state or retry schedule", async () => {
    await placeOrder();
    const [row] = await rows();
    await sendExtra(deps(), p.platformId, row!.id, "tamper_body");
    const after = (await rows())[0]!;
    expect(after.status).toBe("pending");
    expect(after.nextAt).toBe(row!.nextAt);
  });
  it("an event for an order this platform never placed is refused (even with a valid signature)", async () => {
    const other = new TestPlatform(srv.origin);
    const ready = await other.readyCheckout();
    await other.pay(ready.id);
    const [otherRow] = await listRows(store(), other.platformId);
    // the business's genuine, validly signed event for ANOTHER platform's order, aimed at this platform's URL:
    const stolen = { ...otherRow!, webhookUrl: p.webhookUrl, platformId: other.platformId };
    await store().set(`m:${other.platformId}:ox:${otherRow!.id}`, stolen);
    await deliver(deps(), other.platformId, otherRow!.id, { force: true });
    expect((await receipts()).find((r) => r.outcome === "rejected")).toMatchObject({ reason: "unknown_order", httpStatus: 403 });
  });
  it("malformed requests: missing headers, bad payload, unknown platform", async () => {
    const post = (url: string, headers: Record<string, string>, body: string) => fetch(url, { method: "POST", headers, body });
    expect((await post(p.webhookUrl, {}, "{}")).status).toBe(400);
    expect((await post(`${srv.origin}/api/platform/webhooks/orders/not-a-platform`, {}, "{}")).status).toBe(404);
    const noSig = await post(p.webhookUrl, { "webhook-id": "x1", "webhook-timestamp": String(Math.floor(Date.now() / 1000)), "ucp-agent": `profile="${p.businessProfileUrl}"` }, "{}");
    expect(noSig.status).toBe(401);
    expect((await noSig.json()).messages[0].code).toBe("signature_missing");
  });
});

describe("retry policy", () => {
  const failing = (statuses: number[]) => {
    const seen: string[] = [];
    let i = 0;
    const fetchImpl = (async (_url: string, o: { headers?: Record<string, string> }) => {
      seen.push(o.headers?.["webhook-id"] ?? "");
      const status = statuses[Math.min(i++, statuses.length - 1)]!;
      return { status, headers: {}, bodyText: status === 200 ? '{"ucp":{"version":"2026-08-25"}}' : "down", durationMs: 1, resolvedIp: "127.0.0.1" };
    }) as unknown as OutboxDeps["fetchImpl"];
    return { fetchImpl, seen };
  };
  it("backs off between attempts, honours the schedule, and succeeds when the platform recovers", async () => {
    await placeOrder();
    const [row] = await rows();
    let now = Date.now();
    const f = failing([500, 503, 200]);
    const d = () => deps({ fetchImpl: f.fetchImpl, now: () => now });
    let r = await deliver(d(), p.platformId, row!.id);
    expect(r).toMatchObject({ status: "pending" });
    expect(r!.nextAt).toBe(now + 5_000);
    r = await deliver(d(), p.platformId, row!.id); // not yet due
    expect(r!.attempts).toHaveLength(1);
    now += 5_001;
    r = await deliver(d(), p.platformId, row!.id);
    expect(r!.attempts).toHaveLength(2);
    expect(r!.nextAt).toBe(now + 30_000);
    now += 30_001;
    r = await deliver(d(), p.platformId, row!.id);
    expect(r).toMatchObject({ status: "delivered" });
    expect(new Set(f.seen).size).toBe(1); // every attempt carried the SAME Webhook-Id
  });
  it("gives up after 6 failed attempts (dead letter) and 'retry now' ignores the schedule", async () => {
    await placeOrder();
    const [row] = await rows();
    let now = Date.now();
    const f = failing([500]);
    const d = () => deps({ fetchImpl: f.fetchImpl, now: () => now });
    for (let i = 0; i < 5; i++) {
      await deliver(d(), p.platformId, row!.id, { force: true });
      now += 4_000_000;
    }
    expect((await rows())[0]).toMatchObject({ status: "pending" });
    const [forced] = await flush(d(), p.platformId, { force: true });
    expect(forced).toMatchObject({ status: "dead" });
    expect(forced!.attempts).toHaveLength(6);
    expect(await flush(d(), p.platformId, { force: true })).toEqual([]); // dead rows leave the queue
  });
  it("retries are byte-identical: the stored payload is what gets re-sent", async () => {
    await placeOrder();
    const [row] = await rows();
    const bodies: string[] = [];
    const fetchImpl = (async (_u: string, o: { body?: string }) => (bodies.push(o.body as string), { status: 500, headers: {}, bodyText: "", durationMs: 1, resolvedIp: "x" })) as unknown as OutboxDeps["fetchImpl"];
    await deliver(deps({ fetchImpl }), p.platformId, row!.id, { force: true });
    await deliver(deps({ fetchImpl }), p.platformId, row!.id, { force: true });
    expect(bodies[0]).toBe(row!.body);
    expect(bodies[1]).toBe(bodies[0]);
  });
});

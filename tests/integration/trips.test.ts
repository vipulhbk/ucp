import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { priceCheckout } from "@/merchant/pricing";
import { TRIPS } from "@/trips/samples";
import { startServer, Browser } from "./env";

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => void (srv = await startServer()));
afterAll(() => srv.close());

const total = (c: any) => c.totals.find((t: any) => t.type === "total").amount as number;
/** What the merchant's own pricing says these items cost (automatic discount and tax included, no shipping). */
const expectedTotal = (tripId: string) => {
  const trip = TRIPS.find((t) => t.id === tripId)!;
  return priceCheckout({ lines: trip.bookables.map((b, i) => ({ lineId: `l${i}`, itemId: b.variantId, quantity: b.quantity })), codes: [], fulfillmentAmount: 0 }).total;
};

async function started() {
  const b = new Browser(srv.origin);
  expect((await b.post("/api/playground/discovery/fetch", { variant: "default" })).body.ok).toBe(true);
  return b;
}

describe("trip planning API", () => {
  it("returns a plan that names the mock planner as its source", async () => {
    const b = new Browser(srv.origin);
    const r = await b.post("/api/playground/trips/plan", { destination: "Paris, France", interests: ["art"], budgetTier: 4, notes: "" });
    expect(r.status).toBe(200);
    expect(r.body.trip.id).toBe("paris");
    expect(r.body.source).toMatchObject({ kind: "mock" });
    expect(r.body.reasons.length).toBeGreaterThan(0);
  });

  it("rejects malformed requests", async () => {
    const b = new Browser(srv.origin);
    expect((await b.post("/api/playground/trips/plan", { interests: ["art", "kids", "sports", "shopping"] })).status).toBe(400);
    expect((await b.post("/api/playground/trips/plan", { destination: "x".repeat(200) })).status).toBe(400);
  });
});

describe("booking a trip through UCP checkout", () => {
  it.each(TRIPS.map((t) => t.id))("%s: creates a merchant-priced checkout with no shipping step and completes with consent", async (id) => {
    const b = await started();
    const booked = await b.post("/api/playground/trips/book", { tripId: id, email: "asha@example.com", firstName: "Asha" });
    expect(booked.status).toBe(200);
    const co = booked.body.checkout;

    // the two UCP calls really happened, in order, against the business
    expect(booked.body.exchanges.map((e: any) => e.ex.op)).toEqual(["create_checkout", "update_checkout"]);
    expect(co.status).toBe("ready_for_complete");
    expect(co.line_items).toHaveLength(2);
    expect(co.fulfillment).toBeUndefined();
    expect(co.messages ?? []).toEqual([]);
    expect(co.buyer).toMatchObject({ email: "asha@example.com", first_name: "Asha" });
    // the merchant, not the client, priced it
    expect(total(co)).toBe(expectedTotal(id));
    expect(co.line_items.map((l: any) => l.item.id).sort()).toEqual(TRIPS.find((t) => t.id === id)!.bookables.map((x) => x.variantId).sort());

    // paying needs the buyer's explicit authorization of the total they were shown
    const wrong = await b.post("/api/playground/checkout/authorize", { checkoutId: co.id, cardId: "visa_ok", expectedTotal: total(co) - 1 });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toMatchObject({ kind: "consent", code: "mismatch" });

    const done = await b.post("/api/playground/checkout/authorize", { checkoutId: co.id, cardId: "visa_ok", expectedTotal: total(co) });
    expect(done.status).toBe(200);
    expect(done.body.complete.body.status).toBe("completed");
    expect(done.body.complete.body.order.id).toMatch(/^ord_/);

    // and the order is retrievable by the platform that placed it
    const order = await b.call("get_order", { id: done.body.complete.body.order.id });
    expect(order.status).toBe(200);
    expect(order.body.status).toBe(200);
  });

  it("a declined card leaves the checkout open and recoverable", async () => {
    const b = await started();
    const booked = await b.post("/api/playground/trips/book", { tripId: "goa", email: "asha@example.com", firstName: "Asha" });
    const co = booked.body.checkout;
    const done = await b.post("/api/playground/checkout/authorize", { checkoutId: co.id, cardId: "visa_declined", expectedTotal: total(co) });
    expect(done.status).toBe(200);
    expect(done.body.complete.body.status).not.toBe("completed");
    expect(JSON.stringify(done.body.complete.body.messages)).toMatch(/payment_failed/);
  });

  it("validates the booking request and the trip id", async () => {
    const b = await started();
    expect((await b.post("/api/playground/trips/book", { tripId: "atlantis", email: "a@example.com", firstName: "A" })).status).toBe(400);
    expect((await b.post("/api/playground/trips/book", { tripId: "paris", email: "not-an-email", firstName: "A" })).status).toBe(400);
    expect((await b.post("/api/playground/trips/book", { tripId: "paris", email: "a@example.com", firstName: "" })).status).toBe(400);
  });

  it("a cart that mixes a trip voucher with physical goods still needs shipping", async () => {
    const b = await started();
    const created = await b.call("create_checkout", { body: { line_items: [{ item: { id: "var_stay_paris" }, quantity: 1 }, { item: { id: "var_glide_mouse" }, quantity: 1 }] } });
    const co = created.body.body;
    expect(co.fulfillment).toBeDefined();
    expect(co.status).toBe("incomplete");
    expect(JSON.stringify(co.messages)).toMatch(/shipping address/i);
  });

  it("the ordinary electronics checkout is unchanged: it still requires shipping", async () => {
    const b = await started();
    const created = await b.call("create_checkout", { body: { line_items: [{ item: { id: "var_aurora_anc" }, quantity: 1 }] } });
    expect(created.body.body.fulfillment).toBeDefined();
    expect(created.body.body.status).toBe("incomplete");
  });

  it("trips are searchable through the UCP catalog like any other product", async () => {
    const b = await started();
    const r = await b.call("search_catalog", { body: { query: "paris" } });
    const titles = r.body.body.products.map((p: any) => p.title).join(" | ");
    expect(titles).toMatch(/Paris: Left Bank/);
    expect(titles).toMatch(/Paris: Museum/);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("trip planning with Gemini configured", () => {
  const realFetch = globalThis.fetch;
  const KEY = "AIza-test-key-not-real-0123456789";
  let googleCalls: { url: string; init?: RequestInit }[];
  let google: () => Response;
  const goodPlan = {
    title: "Tokyo in four days", destination: "Tokyo", country: "Japan", tagline: "Neon and noodles.", bestSeason: "March to May",
    highlights: ["Shibuya", "Tsukiji"], tips: ["Get a transit card."],
    itinerary: [{ title: "Arrive", items: [{ slot: "morning", title: "Senso-ji", detail: "Go early.", area: "Asakusa", costInr: 500 }] }],
  };
  const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(goodPlan) }] }, finishReason: "STOP" }] }));

  beforeEach(() => {
    googleCalls = [];
    google = ok;
    process.env.GEMINI_API_KEY = KEY;
    // Only Google is faked; the in-process test server still gets real fetches.
    vi.stubGlobal("fetch", (u: RequestInfo | URL, init?: RequestInit) => {
      const url = String(u);
      if (!url.startsWith("https://generativelanguage.googleapis.com/")) return realFetch(u, init);
      googleCalls.push({ url, init });
      return Promise.resolve(google());
    });
  });
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.TRIP_PLANNER;
    delete process.env.GEMINI_PLANS_PER_HOUR;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports which planner is active without ever returning the key", async () => {
    const b = new Browser(srv.origin);
    const r = await b.get("/api/playground/trips/planner");
    expect(r.body).toEqual({ mode: "gemini", model: "gemini-3.5-flash-lite" });
    expect(JSON.stringify(r.body)).not.toContain(KEY);
    delete process.env.GEMINI_API_KEY;
    expect((await b.get("/api/playground/trips/planner")).body).toEqual({ mode: "mock" });
  });

  it("returns a model-written plan labelled as Gemini, and the key travels only in a header", async () => {
    const b = new Browser(srv.origin);
    const r = await b.post("/api/playground/trips/plan", { destination: "Tokyo", interests: ["art"], notes: "4 days" });
    expect(r.status).toBe(200);
    expect(r.body.source).toMatchObject({ kind: "model" });
    expect(r.body.generated.destination).toBe("Tokyo");
    expect(JSON.stringify(r.body)).not.toContain(KEY);
    expect(googleCalls).toHaveLength(1);
    expect(googleCalls[0]!.url).not.toContain(KEY);
    expect((googleCalls[0]!.init!.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
  });

  it("falls back to the labelled mock plan when Gemini is rate limited", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    google = () => new Response("quota", { status: 429 });
    const r = await new Browser(srv.origin).post("/api/playground/trips/plan", { destination: "Paris", interests: [], notes: "" });
    expect(r.status).toBe(200);
    expect(r.body.source.kind).toBe("mock");
    expect(r.body.trip.id).toBe("paris");
    expect(r.body.caveats[0]).toMatch(/rate limit/i);
  });

  it("TRIP_PLANNER=mock forces the mock and never calls Google", async () => {
    process.env.TRIP_PLANNER = "mock";
    const r = await new Browser(srv.origin).post("/api/playground/trips/plan", { destination: "Goa", interests: [], notes: "" });
    expect(r.body.source.kind).toBe("mock");
    expect(googleCalls).toHaveLength(0);
  });

  it("stops calling Gemini for a visitor who exceeds the hourly allowance, and says so", async () => {
    process.env.GEMINI_PLANS_PER_HOUR = "2";
    const b = new Browser(srv.origin);
    const plan = () => b.post("/api/playground/trips/plan", { destination: "Tokyo", interests: [], notes: "" });
    expect((await plan()).body.source.kind).toBe("model");
    expect((await plan()).body.source.kind).toBe("model");
    const third = await plan();
    expect(third.body.source.kind).toBe("mock");
    expect(third.body.caveats[0]).toMatch(/hourly allowance/i);
    expect(googleCalls).toHaveLength(2);
  });
});

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findVariant } from "@/merchant/catalog/data";
import { HIGH_VALUE_PAISE } from "@/merchant/checkout/render";
import { priceCheckout } from "@/merchant/pricing";
import { MockTripPlanner, rankTrips } from "@/trips/planner";
import { TRIPS, tripById } from "@/trips/samples";
import { INTERESTS, TripSchema, type PlanRequest } from "@/trips/types";

const req = (r: Partial<PlanRequest>): PlanRequest => ({ destination: "", interests: [], notes: "", ...r });

describe("sample trips", () => {
  it("ships between 5 and 10 ready-made trips with unique ids", () => {
    expect(TRIPS.length).toBeGreaterThanOrEqual(5);
    expect(TRIPS.length).toBeLessThanOrEqual(10);
    expect(new Set(TRIPS.map((t) => t.id)).size).toBe(TRIPS.length);
  });

  it.each(TRIPS.map((t) => [t.id, t] as const))("%s satisfies the trip contract", (_id, trip) => {
    expect(() => TripSchema.parse(trip)).not.toThrow();
    expect(trip.itinerary.map((d) => d.day)).toEqual(Array.from({ length: trip.days }, (_, i) => i + 1));
    expect(trip.interests.every((i) => INTERESTS.includes(i))).toBe(true);
    expect(existsSync(join(process.cwd(), "public", trip.cover))).toBe(true);
  });

  it("covers every interest the form offers, so every selection can find a trip", () => {
    for (const i of INTERESTS) expect(TRIPS.some((t) => t.interests.includes(i)), i).toBe(true);
  });

  it.each(TRIPS.map((t) => [t.id, t] as const))("%s: every bookable is a real digital catalog variant", (_id, trip) => {
    for (const b of trip.bookables) {
      const found = findVariant(b.variantId);
      expect(found, b.variantId).toBeDefined();
      expect(found!.product.digital).toBe(true);
      expect(found!.variant.stock).toBeGreaterThanOrEqual(b.quantity);
      expect(found!.variant.delisted).toBeFalsy();
    }
  });

  it.each(TRIPS.map((t) => [t.id, t] as const))("%s: the booking total, tax included, stays under the merchant's review limit", (_id, trip) => {
    const { total } = priceCheckout({ lines: trip.bookables.map((b, i) => ({ lineId: `l${i}`, itemId: b.variantId, quantity: b.quantity })), codes: [], fulfillmentAmount: 0 });
    expect(total).toBeLessThan(HIGH_VALUE_PAISE);
  });

  it("states that prices are illustrative and carries no invented opening hours", () => {
    for (const t of TRIPS) expect(t.tips.join(" ")).toMatch(/demo prices only|confirm real/i);
  });
});

describe("mock planner", () => {
  const planner = new MockTripPlanner();

  it("is deterministic and labels itself as a mock, never as a model", async () => {
    const a = await planner.plan(req({ destination: "Paris, France", interests: ["art"] }));
    const b = await planner.plan(req({ destination: "Paris, France", interests: ["art"] }));
    expect(a).toEqual(b);
    expect(a.source.kind).toBe("mock");
    expect(a.source.name).toMatch(/no AI model/i);
  });

  it("matches a destination by city, country or nickname", async () => {
    for (const [text, id] of [["Paris, France", "paris"], ["rajasthan", "jaipur"], ["Greece", "santorini"], ["japan trip", "kyoto"], ["Ubud", "bali"]] as const) {
      expect((await planner.plan(req({ destination: text }))).trip.id, text).toBe(id);
    }
  });

  it("lets the destination outrank interests", async () => {
    const r = await planner.plan(req({ destination: "Goa", interests: ["art", "romantic", "shopping"] }));
    expect(r.trip.id).toBe("goa");
  });

  it("picks by interests when no destination is given", async () => {
    expect((await planner.plan(req({ interests: ["kids"] }))).trip.id).toBe("singapore");
    expect((await planner.plan(req({ interests: ["sports", "scenic"] }))).trip.id).toBe("manali");
    expect((await planner.plan(req({ interests: ["beaches", "nightlife"] }))).trip.id).toBe("goa");
  });

  it("uses the budget band to break ties", () => {
    const cheap = rankTrips(req({ interests: ["scenic"], budgetTier: 1 }));
    const dear = rankTrips(req({ interests: ["scenic"], budgetTier: 4 }));
    expect(cheap[0]!.trip.id).toBe("manali");
    expect(dear[0]!.trip.id).toBe("santorini");
  });

  it("honours 'avoid night life' by ranking nightlife trips lower, and says so", () => {
    const plain = rankTrips(req({ interests: ["beaches"] }));
    const avoid = rankTrips(req({ interests: ["beaches"], notes: "please avoid night life" }));
    expect(plain[0]!.trip.id).toBe("goa");
    expect(avoid[0]!.trip.id).not.toBe("goa");
    expect(avoid.find((s) => s.trip.id === "goa")!.reasons.join(" ")).toMatch(/avoid night life/i);
  });

  it("admits when it has no trip for the typed destination instead of faking one", async () => {
    const r = await planner.plan(req({ destination: "Reykjavik", interests: ["scenic"] }));
    expect(r.caveats.join(" ")).toMatch(/no ready-made trip for "Reykjavik"/);
    expect(TRIPS.map((t) => t.id)).toContain(r.trip.id);
  });

  it("flags a requested trip length it cannot honour", async () => {
    const r = await planner.plan(req({ destination: "Paris", notes: "we want 10 days" }));
    expect(r.caveats.join(" ")).toMatch(/10 days.*cannot resize/);
  });

  it("says when free-text notes are only partly understood", async () => {
    const r = await planner.plan(req({ destination: "Paris", notes: "my cousin recommended a bakery" }));
    expect(r.caveats.join(" ")).toMatch(/only partly understood/);
  });

  it("handles an empty request, rejects an over-long destination and unknown interests", async () => {
    const r = await planner.plan(req({}));
    expect(r.trip.id).toBe(TRIPS[0]!.id);
    expect(r.caveats.join(" ")).toMatch(/no preferences/);
    await expect(planner.plan(req({ destination: "x".repeat(81) }))).rejects.toThrow();
    await expect(planner.plan({ destination: "", interests: ["gambling" as never], notes: "" })).rejects.toThrow();
    await expect(planner.plan(req({ interests: ["art", "kids", "sports", "shopping"] }))).rejects.toThrow();
  });

  it("tripById finds every trip and nothing else", () => {
    for (const t of TRIPS) expect(tripById(t.id)).toBe(t);
    expect(tripById("atlantis")).toBeUndefined();
  });
});

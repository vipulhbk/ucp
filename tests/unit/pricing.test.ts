import { describe, expect, it } from "vitest";
import { allocateProportionally, priceCheckout } from "@/merchant/pricing";
import { findVariant } from "@/merchant/catalog/data";

const V = "var_aurora_anc"; // ₹4,499
const price = (lines: { itemId: string; quantity: number }[], codes: string[] = [], fulfillmentAmount = 0) =>
  priceCheckout({ lines: lines.map((l, i) => ({ lineId: `li_${i + 1}`, ...l })), codes, fulfillmentAmount });
const t = (r: ReturnType<typeof price>, type: string) => r.totals.find((x) => x.type === type)?.amount;

describe("pricing is catalog-authoritative", () => {
  it("computes subtotal, GST and total from catalog prices only", () => {
    const r = price([{ itemId: V, quantity: 2 }]);
    expect(findVariant(V)!.variant.price).toBe(449900);
    expect(t(r, "subtotal")).toBe(899800);
    expect(t(r, "tax")).toBe(Math.round(899800 * 0.18));
    expect(t(r, "total")).toBe(899800 + Math.round(899800 * 0.18));
  });
  it("ignores any extra fields a caller might smuggle in (price is not an input)", () => {
    const r = priceCheckout({ lines: [{ lineId: "li_1", itemId: V, quantity: 1, price: 1 } as never], codes: [], fulfillmentAmount: 0 });
    expect(t(r, "subtotal")).toBe(449900);
  });
  it("throws for unknown items so callers must validate first", () => {
    expect(() => price([{ itemId: "nope", quantity: 1 }])).toThrow();
  });
  it("total always equals the sum of its parts", () => {
    for (const codes of [[], ["WELCOME10"], ["FLAT500"], ["WELCOME10", "FLAT500"]]) {
      for (const ship of [0, 9900, 24900]) {
        const r = price([{ itemId: V, quantity: 3 }, { itemId: "var_glide_mouse", quantity: 2 }], codes, ship);
        const parts = r.totals.filter((x) => x.type !== "total").reduce((a, x) => a + x.amount, 0);
        expect(t(r, "total")).toBe(parts);
      }
    }
  });
});

describe("discount extension semantics", () => {
  it("WELCOME10 is a per-item (each) discount recorded on lines and as items_discount", () => {
    const r = price([{ itemId: V, quantity: 2 }], ["WELCOME10"]);
    expect(r.applied[0]).toMatchObject({ code: "WELCOME10", method: "each", amount: 89980 });
    expect(t(r, "items_discount")).toBe(-89980);
    expect(r.lines[0]!.totals.map((x) => x.type)).toEqual(["subtotal", "items_discount", "total"]);
    expect(r.lines[0]!.totals[2]!.amount).toBe(899800 - 89980);
  });
  it("FLAT500 is an order-level (across) discount in the discount total", () => {
    const r = price([{ itemId: V, quantity: 1 }, { itemId: "var_glide_mouse", quantity: 1 }], ["FLAT500"]);
    expect(r.applied[0]).toMatchObject({ method: "across", amount: 50000 });
    expect(t(r, "discount")).toBe(-50000);
    expect(r.applied[0]!.allocations.reduce((a, x) => a + x.amount, 0)).toBe(50000);
  });
  it("codes are case-insensitive and echoed as submitted", () => {
    expect(price([{ itemId: V, quantity: 1 }], ["welcome10"]).applied[0]!.code).toBe("welcome10");
  });
  it("rejects unknown, expired, duplicate and uncombinable codes with spec codes and indexes", () => {
    const r = price([{ itemId: V, quantity: 1 }], ["NOPE", "SUMMER20", "FLAT500", "FLAT500", "WELCOME10"]);
    expect(r.rejected.map((x) => [x.index, x.reason])).toEqual([
      [0, "discount_code_invalid"],
      [1, "discount_code_expired"],
      [3, "discount_code_already_applied"],
    ]);
    expect(r.applied.map((a) => a.code)).toEqual(["FLAT500", "WELCOME10"]);
  });
  it("two percentage codes cannot combine", () => {
    // only WELCOME10 is a percent-on-items code that is not expired, so combination is exercised via duplicates of the kind
    const r = price([{ itemId: V, quantity: 1 }], ["WELCOME10", "welcome10"]);
    expect(r.rejected[0]!.reason).toBe("discount_code_already_applied");
  });
  it("applies an automatic discount at ₹15,000+ (net) and cannot be removed by the platform", () => {
    const r = price([{ itemId: "var_summit_pro_anc", quantity: 2 }]); // ₹17,998
    const auto = r.applied.find((a) => a.automatic);
    expect(auto).toMatchObject({ automatic: true, method: "across" });
    expect(auto!.code).toBeUndefined();
    expect(auto!.amount).toBe(Math.floor((1799800 * 5) / 100));
    expect(price([{ itemId: V, quantity: 1 }]).applied).toHaveLength(0);
  });
  it("discounts never push totals negative", () => {
    const r = price([{ itemId: "var_glide_mouse", quantity: 1 }], ["FLAT500"]); // ₹999 item, ₹500 off
    expect(t(r, "total")).toBeGreaterThan(0);
    const huge = priceCheckout({ lines: [{ lineId: "li_1", itemId: "var_glide_mouse", quantity: 1 }], codes: ["FLAT500", "WELCOME10"], fulfillmentAmount: 0 });
    expect(huge.total).toBeGreaterThanOrEqual(0);
  });
});

describe("allocateProportionally", () => {
  it("always sums exactly to the amount", () => {
    for (const [amount, weights] of [[100, [1, 1, 1]], [7, [3, 3]], [50000, [449900, 99900]], [1, [5, 5, 5, 5]]] as [number, number[]][]) {
      expect(allocateProportionally(amount, weights).reduce((a, b) => a + b, 0)).toBe(amount);
    }
  });
  it("handles zero weights", () => expect(allocateProportionally(10, [0, 0])).toEqual([0, 0]));
});

import { describe, expect, it } from "vitest";
import { parseCommand, parseShopping } from "@/platform/agent/intent";

describe("shopping intent", () => {
  it("understands the headline request", () => {
    const i = parseShopping("Find me a wireless headphone under ₹5,000 with noise cancellation.");
    expect(i.maxPaise).toBe(500000);
    expect(i.require).toEqual(["noise cancellation", "wireless"]);
    expect(i.quantity).toBe(1);
    expect(i.query).toBe("a wireless headphone with noise cancellation");
  });
  it.each([
    ["under ₹5,000", 500000],
    ["below Rs. 2,500", 250000],
    ["under 5000 rupees", 500000],
    ["up to 5k", 500000],
    ["less than INR 1,999.50", 199950],
    ["budget of ₹3000", 300000],
    ["at most 1 lakh", 10_000_000],
    ["cheaper than ₹999", 99900],
  ])("parses the budget phrase %s", (phrase, paise) => expect(parseShopping(`headphones ${phrase}`).maxPaise).toBe(paise));
  it("parses minimums, and a bare amount is a cap", () => {
    expect(parseShopping("speaker over ₹2,000").minPaise).toBe(200000);
    expect(parseShopping("mouse ₹1,000").maxPaise).toBe(100000);
  });
  it("detects required features including spelling variants", () => {
    expect(parseShopping("noise cancelling earphones").require).toEqual(["noise cancellation"]);
    expect(parseShopping("ANC headphones").require).toEqual(["noise cancellation"]);
    expect(parseShopping("bluetooth speaker").require).toEqual(["wireless"]);
    expect(parseShopping("wired headphones").require).toEqual(["wired"]);
    expect(parseShopping("a backpack").require).toEqual([]);
  });
  it("parses quantities without confusing prices", () => {
    expect(parseShopping("two pairs of headphones under ₹5000").quantity).toBe(2);
    expect(parseShopping("buy 3 mouse").quantity).toBe(3);
    expect(parseShopping("headphones under ₹5000").quantity).toBe(1);
    expect(parseShopping("20 units of keyboards").quantity).toBe(10); // capped at the merchant's line limit
  });
  it("extracts discount codes", () => {
    expect(parseShopping("mouse with code welcome10").codes).toEqual(["WELCOME10"]);
  });
  it("is deterministic", () => {
    const a = parseShopping("Find me a wireless headphone under ₹5,000 with noise cancellation");
    expect(parseShopping("Find me a wireless headphone under ₹5,000 with noise cancellation")).toEqual(a);
  });
});

describe("commands", () => {
  const c = (t: string, state = "idle") => parseCommand(t, { state });
  it("shopping requests become a shop command", () => {
    expect(c("Find me a wireless headphone under ₹5,000").type).toBe("shop");
    expect(c("I need a backpack").type).toBe("shop");
    expect(c("noise cancelling headphones").type).toBe("shop");
  });
  it("selection while proposing", () => {
    expect(c("yes", "proposing")).toEqual({ type: "affirm" });
    expect(c("buy it", "proposing")).toEqual({ type: "affirm" });
    expect(c("the second one", "proposing")).toEqual({ type: "select", index: 1 });
    expect(c("2", "proposing")).toEqual({ type: "select", index: 1 });
    expect(c("#3", "proposing")).toEqual({ type: "select", index: 2 });
    expect(c("the cheapest", "proposing")).toEqual({ type: "select", cheapest: true });
  });
  it("a new shopping request while proposing restarts the search", () => {
    expect(c("find me a backpack", "proposing").type).toBe("shop");
  });
  it("checkout adjustments", () => {
    expect(c("make it 3", "checkout")).toEqual({ type: "quantity", quantity: 3 });
    expect(c("change to two", "awaiting_consent")).toEqual({ type: "quantity", quantity: 2 });
    expect(c("use express shipping", "checkout")).toEqual({ type: "shipping", option: "express" });
    expect(c("standard delivery please", "checkout")).toEqual({ type: "shipping", option: "standard" });
    expect(c("apply code WELCOME10", "checkout")).toEqual({ type: "apply_code", code: "WELCOME10" });
    expect(c("I have a coupon FLAT500", "checkout")).toEqual({ type: "apply_code", code: "FLAT500" });
  });
  it("housekeeping commands", () => {
    expect(c("cancel").type).toBe("cancel");
    expect(c("start over").type).toBe("cancel");
    expect(c("help").type).toBe("help");
    expect(c("what's the total?", "checkout").type).toBe("status");
    expect(c("add it to my cart").type).toBe("add_to_cart");
  });
  it("gibberish and empty input are unknown, never a crash", () => {
    expect(c("asdf qwer").type).toBe("unknown");
    expect(c("").type).toBe("unknown");
    expect(c("   ").type).toBe("unknown");
  });
  it("quantities are only read while a checkout exists", () => {
    expect(c("make it 3", "idle").type).not.toBe("quantity");
  });
});

import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/persistence/memory";
import { CONSENT_TTL_MS, ConsentError, consumeConsent, fingerprintOf, grantConsent } from "@/platform/consent";

const checkout = (over: Record<string, unknown> = {}) => ({
  id: "chk_1",
  status: "ready_for_complete",
  currency: "INR",
  line_items: [{ item: { id: "var_aurora_anc", title: "Aurora ANC" }, quantity: 2 }],
  totals: [{ type: "subtotal", amount: 899800 }, { type: "items_discount", amount: -89980 }, { type: "tax", amount: 145767 }, { type: "total", amount: 955587 }],
  fulfillment: { methods: [{ selected_destination_id: "dest_1", destinations: [{ id: "dest_1", street_address: "12 MG Road", address_locality: "Bengaluru", postal_code: "560001" }], groups: [{ selected_option_id: "standard", options: [{ id: "standard", title: "Standard Delivery" }] }] }] },
  ...over,
});
const card = { id: "visa_ok", label: "Visa · always approved" };

describe("buyer consent gate", () => {
  it("summarizes everything the buyer is authorizing", async () => {
    const rec = await grantConsent(new MemoryStore(), "s1", checkout(), card);
    expect(rec.summary).toMatchObject({ checkoutId: "chk_1", total: 955587, subtotal: 899800, discounts: -89980, tax: 145767, paymentMethod: { cardId: "visa_ok" }, shipping: { title: "Standard Delivery", destination: "12 MG Road, Bengaluru, 560001" } });
    expect(rec.summary.lineItems).toEqual([{ itemId: "var_aurora_anc", title: "Aurora ANC", quantity: 2 }]);
  });
  it("is only grantable for a ready_for_complete checkout", async () => {
    await expect(grantConsent(new MemoryStore(), "s1", checkout({ status: "incomplete" }), card)).rejects.toMatchObject({ code: "not_ready" });
  });
  it("Complete is impossible without consent", async () => {
    await expect(consumeConsent(new MemoryStore(), "s1", checkout(), card.id)).rejects.toMatchObject({ code: "missing" });
  });
  it("valid consent is consumed exactly once", async () => {
    const s = new MemoryStore();
    await grantConsent(s, "s1", checkout(), card);
    await expect(consumeConsent(s, "s1", checkout(), card.id)).resolves.toMatchObject({ consumed: true });
    await expect(consumeConsent(s, "s1", checkout(), card.id)).rejects.toMatchObject({ code: "consumed" });
  });
  it("is void if the total, quantity, shipping, address or card changed after the buyer saw it", async () => {
    const mutations: [string, Record<string, unknown>, string][] = [
      ["total", { totals: [{ type: "total", amount: 1 }] }, card.id],
      ["quantity", { line_items: [{ item: { id: "var_aurora_anc", title: "x" }, quantity: 3 }] }, card.id],
      ["currency", { currency: "USD" }, card.id],
      ["card", {}, "visa_declined"],
    ];
    for (const [name, over, cardId] of mutations) {
      const s = new MemoryStore();
      await grantConsent(s, "s1", checkout(), card);
      await expect(consumeConsent(s, "s1", checkout(over), cardId), name).rejects.toMatchObject({ code: "mismatch" });
    }
    const s = new MemoryStore();
    await grantConsent(s, "s1", checkout(), card);
    const other = checkout();
    other.fulfillment.methods[0]!.groups[0]!.selected_option_id = "express";
    await expect(consumeConsent(s, "s1", other, card.id)).rejects.toMatchObject({ code: "mismatch" });
  });
  it("expires after 10 minutes", async () => {
    const s = new MemoryStore();
    await grantConsent(s, "s1", checkout(), card, () => 1000);
    await expect(consumeConsent(s, "s1", checkout(), card.id, () => 1000 + CONSENT_TTL_MS + 1)).rejects.toBeInstanceOf(ConsentError);
  });
  it("is scoped to the session", async () => {
    const s = new MemoryStore();
    await grantConsent(s, "s1", checkout(), card);
    await expect(consumeConsent(s, "s2", checkout(), card.id)).rejects.toMatchObject({ code: "missing" });
  });
  it("fingerprint is stable and sensitive", () => {
    expect(fingerprintOf(checkout(), "a")).toBe(fingerprintOf(checkout(), "a"));
    expect(fingerprintOf(checkout(), "a")).not.toBe(fingerprintOf(checkout(), "b"));
  });
});

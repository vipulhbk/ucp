import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/persistence/memory";
import { TEST_CARDS, charge, luhnValid, tokenize } from "@/sim/psp";

const binding = { type: "dev.ucp.shopping.checkout", id: "chk_1" };
const pan = (number: string) => ({ type: "pan", number });

describe("simulated tokenizer", () => {
  it("every published test card is Luhn-valid", () => TEST_CARDS.forEach((c) => expect(luhnValid(c.number)).toBe(true)));
  it("issues a token for a test card and returns only display-safe data", async () => {
    const r = await tokenize(new MemoryStore(), "p1", { credential: pan("4242 4242 4242 4242"), binding });
    expect(r).toMatchObject({ ok: true, display: { brand: "visa", last4: "4242" } });
    expect(JSON.stringify(r)).not.toContain("4242424242424242");
  });
  it("REFUSES real-looking (Luhn-valid) non-test card numbers and never echoes them", async () => {
    const r = await tokenize(new MemoryStore(), "p1", { credential: pan("4111111111111111"), binding });
    expect(r).toMatchObject({ ok: false, code: "non_test_credential", status: 422 });
    expect(JSON.stringify(r)).not.toContain("4111");
  });
  it("refuses garbage and non-pan credentials", async () => {
    const s = new MemoryStore();
    expect((await tokenize(s, "p", { credential: pan("1234"), binding })).ok).toBe(false);
    expect(await tokenize(s, "p", { credential: { type: "token" }, binding })).toMatchObject({ code: "unsupported_credential_type" });
  });
  it("requires a binding with a non-empty id", async () => {
    expect(await tokenize(new MemoryStore(), "p", { credential: pan("4242424242424242"), binding: { type: "x", id: "" } })).toMatchObject({ code: "invalid_binding", status: 400 });
    expect(await tokenize(new MemoryStore(), "p", { credential: pan("4242424242424242") })).toMatchObject({ code: "invalid_binding" });
  });
});

describe("simulated PSP charge", () => {
  const issue = async (s: MemoryStore, number: string, pid = "p1", b = binding) => {
    const r = await tokenize(s, pid, { credential: pan(number), binding: b });
    if (!r.ok) throw new Error("tokenize failed");
    return r.token;
  };
  const amt = { amount: 1000, currency: "INR" };

  it("approves, declines, insufficient-funds and async deterministically", async () => {
    const s = new MemoryStore();
    expect((await charge(s, "p1", { token: await issue(s, "4242424242424242"), binding, ...amt })).outcome).toBe("approved");
    expect((await charge(s, "p1", { token: await issue(s, "4000000000000002"), binding, ...amt })).outcome).toBe("declined");
    expect((await charge(s, "p1", { token: await issue(s, "4000000000009995"), binding, ...amt })).outcome).toBe("insufficient_funds");
    expect((await charge(s, "p1", { token: await issue(s, "4000000000003220"), binding, ...amt })).outcome).toBe("async");
  });
  it("binding is an exact-equality replay guard", async () => {
    const s = new MemoryStore();
    const token = await issue(s, "4242424242424242");
    expect(await charge(s, "p1", { token, binding: { ...binding, id: "chk_2" }, ...amt })).toMatchObject({ outcome: "invalid_token", message: expect.stringContaining("different resource") });
    expect(await charge(s, "p1", { token, binding: { type: "dev.ucp.shopping.cart", id: "chk_1" }, ...amt })).toMatchObject({ outcome: "invalid_token" });
  });
  it("an approved token is single-use; a declined one may be retried", async () => {
    const s = new MemoryStore();
    const ok = await issue(s, "4242424242424242");
    await charge(s, "p1", { token: ok, binding, ...amt });
    expect((await charge(s, "p1", { token: ok, binding, ...amt })).outcome).toBe("invalid_token");
    const bad = await issue(s, "4000000000000002");
    await charge(s, "p1", { token: bad, binding, ...amt });
    expect((await charge(s, "p1", { token: bad, binding, ...amt })).outcome).toBe("declined");
  });
  it("tokens are scoped to the platform that created them and expire", async () => {
    const s = new MemoryStore();
    const token = await issue(s, "4242424242424242", "p1");
    expect((await charge(s, "p2", { token, binding, ...amt })).outcome).toBe("invalid_token");
    expect((await charge(s, "p1", { token, binding, ...amt }, () => Date.now() + 16 * 60_000)).outcome).toBe("invalid_token");
  });
});

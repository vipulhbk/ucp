import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, startServer } from "./env";

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => void (srv = await startServer()));
afterAll(() => srv.close());

const HEADLINE = "Find me a wireless headphone under ₹5,000 with noise cancellation.";
type Run = any;
const say = async (b: Browser, text: string): Promise<Run> => (await b.post("/api/playground/agent/message", { text })).body.run;
const last = (run: Run) => run.transcript.at(-1).text as string;
const kinds = (run: Run) => run.timeline.map((e: { kind: string }) => e.kind);

async function toReady(b: Browser, extra = "") {
  await b.post("/api/playground/discovery/fetch", { variant: "default" });
  let run = await say(b, HEADLINE);
  expect(run.state).toBe("proposing");
  run = await say(b, `yes${extra}`);
  return run;
}
const authorize = async (b: Browser, run: Run, cardId: string, expectedTotal = run.pending.expectedTotal) => {
  const r = await b.post("/api/playground/checkout/authorize", { checkoutId: run.pending.checkoutId, cardId, expectedTotal });
  return r;
};
const observe = async (b: Browser, cardId?: string): Promise<Run> => (await b.post("/api/playground/agent/message", { event: "authorization_attempted", cardId })).body.run;

describe("agent: understanding and searching", () => {
  it("turns the headline request into a real catalog search and recommends the best match", async () => {
    const b = new Browser(srv.origin);
    await b.post("/api/playground/discovery/fetch", {});
    const run = await say(b, HEADLINE);
    expect(run.state).toBe("proposing");
    expect(run.candidates[0]).toMatchObject({ productId: "prod_aurora_anc", price: 449900 });
    expect(run.candidates.map((c: { title: string }) => c.title).join()).not.toMatch(/Summit/); // over budget
    expect(run.candidates.map((c: { title: string }) => c.title).join()).not.toMatch(/Pulse/); // no ANC: filtered by the agent, not trusted to search
    expect(last(run)).toContain("₹4,499.00");
    expect(kinds(run)).toEqual(expect.arrayContaining(["discover", "search"]));
    expect(run.pending).toEqual({ type: "choose_product" });
  });
  it("every timeline step that touched the merchant links to a real, logged exchange", async () => {
    const b = new Browser(srv.origin);
    await toReady(b);
    const run = (await b.get("/api/playground/agent")).body.run;
    const log = (await b.get("/api/playground/inspector/events")).body.events as { correlationId: string; actor: string }[];
    const linked = run.timeline.filter((e: { correlationId?: string }) => e.correlationId);
    expect(linked.length).toBeGreaterThanOrEqual(4);
    for (const e of linked) {
      const sides = log.filter((l) => l.correlationId === e.correlationId).map((l) => l.actor);
      expect(sides, e.title).toContain("platform");
      if (e.op !== "get_profile") expect(sides, e.title).toContain("business"); // both ends of the same Request-Id
    }
  });
  it("says so honestly when nothing matches", async () => {
    const b = new Browser(srv.origin);
    await b.post("/api/playground/discovery/fetch", {});
    const run = await say(b, "find me noise cancelling headphones under ₹500");
    expect(run.state).toBe("idle");
    expect(last(run)).toMatch(/nothing satisfies|nothing/i);
    expect(run.candidates).toEqual([]);
  });
  it("does not offer products that are out of stock", async () => {
    const b = new Browser(srv.origin);
    await b.post("/api/playground/discovery/fetch", {});
    const run = await say(b, "find me a limited edition lamp");
    expect(run.candidates.map((c: { productId: string }) => c.productId)).not.toContain("prod_nova_lamp_limited");
  });
  it("is deterministic: the same conversation yields the same decisions", async () => {
    const shape = async () => {
      const b = new Browser(srv.origin);
      const run = await toReady(b);
      return { cand: run.candidates.map((c: { variantId: string }) => c.variantId), kinds: kinds(run), total: run.pending.expectedTotal, said: run.transcript.filter((m: { role: string }) => m.role === "agent").map((m: { text: string }) => m.text.replace(/chk_\w+/g, "CHK")) };
    };
    expect(await shape()).toEqual(await shape());
  });
});

describe("agent: checkout through UCP only", () => {
  it("selects, creates the checkout, resolves recoverable messages with the profile, and stops at the consent gate", async () => {
    const b = new Browser(srv.origin);
    const run = await toReady(b);
    expect(run.state).toBe("awaiting_consent");
    expect(kinds(run)).toEqual(expect.arrayContaining(["select", "create_checkout", "update_checkout", "fix", "present", "await_consent"]));
    expect(run.pending).toMatchObject({ type: "authorize", currency: "INR", expectedTotal: expect.any(Number) });
    expect(run.pending.cards.length).toBeGreaterThan(1);
    const co = (await b.call("get_checkout", { id: run.checkoutId })).body.body;
    expect(co.status).toBe("ready_for_complete");
    expect(co.buyer.email).toBe("asha@example.com"); // filled from the profile in response to `missing` messages
    expect(co.totals.find((t: { type: string }) => t.type === "total").amount).toBe(run.pending.expectedTotal);
    expect(last(run)).toMatch(/can't pay for you/);
  });
  it("the agent cannot authorize: asking it to pay changes nothing and no order or consent exists", async () => {
    const b = new Browser(srv.origin);
    const run = await toReady(b);
    for (const text of ["yes", "pay now", "go ahead and buy it", "authorize"]) {
      const r = await say(b, text);
      expect(r.state).toBe("awaiting_consent");
      expect(last(r)).toMatch(/authorize|confirmation card|can't/i);
    }
    expect((await b.get("/api/playground/orders")).body.orders).toEqual([]);
    expect((await b.post("/api/playground/checkout/complete", { checkoutId: run.checkoutId, cardId: "visa_ok" })).status).toBe(403);
  });
  it("a forged 'I authorized' event cannot make the agent believe an order exists", async () => {
    const b = new Browser(srv.origin);
    const run = await toReady(b);
    const after = await observe(b, "visa_ok");
    expect(after.state).not.toBe("ordered");
    expect(after.orderId).toBeUndefined();
    expect(after.checkoutId).toBe(run.checkoutId);
  });
  it("after the buyer's real authorization the agent confirms the order from the merchant", async () => {
    const b = new Browser(srv.origin);
    const run = await toReady(b);
    expect((await authorize(b, run, "visa_ok")).status).toBe(200);
    const done = await observe(b, "visa_ok");
    expect(done.state).toBe("ordered");
    expect(done.orderId).toMatch(/^ord_/);
    expect(kinds(done)).toEqual(expect.arrayContaining(["complete", "order"]));
    expect(last(done)).toContain("simulated payment");
    expect((await b.call("get_order", { id: done.orderId })).body.body.checkout_id).toBe(run.checkoutId);
  });
  it("the buyer can only authorize the total the agent showed", async () => {
    const b = new Browser(srv.origin);
    const run = await toReady(b);
    const r = await authorize(b, run, "visa_ok", run.pending.expectedTotal - 100);
    expect(r.status).toBe(403);
  });
});

describe("agent: adjustments and error recovery", () => {
  it("applies a discount code, a quantity change and express shipping, re-presenting each time", async () => {
    const b = new Browser(srv.origin);
    let run = await toReady(b);
    const base = run.pending.expectedTotal;
    run = await say(b, "apply code WELCOME10");
    expect(run.pending.expectedTotal).toBeLessThan(base);
    expect(run.timeline.some((e: { title: string }) => /Discount WELCOME10 applied/.test(e.title))).toBe(true);
    const withCode = run.pending.expectedTotal;
    run = await say(b, "make it 2");
    expect(run.pending.expectedTotal).toBeGreaterThan(withCode);
    run = await say(b, "use express shipping");
    const co = (await b.call("get_checkout", { id: run.checkoutId })).body.body;
    expect(co.fulfillment.methods[0].groups[0].selected_option_id).toBe("express");
    expect(co.line_items[0].quantity).toBe(2);
    expect(co.discounts.applied.map((a: { code?: string }) => a.code)).toContain("WELCOME10");
    expect(run.state).toBe("awaiting_consent");
  });
  it("tells the buyer when the merchant rejects a code and drops it", async () => {
    const b = new Browser(srv.origin);
    let run = await toReady(b);
    run = await say(b, "apply code SUMMER20");
    expect(run.transcript.map((m: { text: string }) => m.text).join("\n")).toMatch(/rejected SUMMER20.*expired/i);
    expect(run.codes).not.toContain("SUMMER20");
    expect(run.state).toBe("awaiting_consent");
  });
  it("payment failure: explains, keeps nothing charged, and re-presents with a different default card", async () => {
    const b = new Browser(srv.origin);
    const run = await toReady(b);
    await authorize(b, run, "visa_declined");
    const failed = await observe(b, "visa_declined");
    expect(failed.state).toBe("awaiting_consent"); // ready to try again
    expect(failed.pending.failedCardId).toBe("visa_declined");
    expect(failed.pending.defaultCardId).not.toBe("visa_declined");
    expect(failed.transcript.map((m: { text: string }) => m.text).join("\n")).toMatch(/payment didn't go through[\s\S]*declined/i);
    expect((await b.get("/api/playground/orders")).body.orders).toEqual([]);
    // retry with a fresh authorization
    expect((await authorize(b, failed, "mc_ok")).status).toBe(200);
    expect((await observe(b, "mc_ok")).state).toBe("ordered");
  });
  it("async payment: the agent polls Get Checkout until the merchant completes it", async () => {
    const b = new Browser(srv.origin);
    const run = await toReady(b);
    await authorize(b, run, "visa_async");
    const done = await observe(b, "visa_async");
    expect(done.state).toBe("ordered");
    expect(done.timeline.some((e: { title: string }) => /Get Checkout/.test(e.title))).toBe(true);
  });
  it("an undeliverable address stops the agent and asks the buyer; fixing the profile lets it continue", async () => {
    const b = new Browser(srv.origin);
    await b.post("/api/playground/discovery/fetch", {});
    await b.post("/api/playground/agent/profile", { email: "a@example.com", first_name: "A", last_name: "B", street_address: "1 Main St", address_locality: "Springfield", address_region: "IL", postal_code: "62701", address_country: "US" });
    await say(b, HEADLINE);
    let run = await say(b, "yes");
    expect(run.state).toBe("checkout");
    expect(last(run)).toMatch(/only deliver within India|delivery address/i);
    await b.post("/api/playground/agent/profile", { email: "a@example.com", first_name: "A", last_name: "B", street_address: "12 MG Road", address_locality: "Bengaluru", address_region: "KA", postal_code: "560001", address_country: "IN" });
    run = await say(b, "status");
    expect(run.state).toBe("awaiting_consent");
  });
  it("cancel closes the merchant's checkout and clears the agent's state", async () => {
    const b = new Browser(srv.origin);
    const run = await toReady(b);
    const after = await say(b, "cancel");
    expect(after.state).toBe("idle");
    expect(after.pending).toBeUndefined();
    expect((await b.call("get_checkout", { id: run.checkoutId })).body.body.status).toBe("canceled");
  });
  it("a new request mid-checkout cancels the old checkout first", async () => {
    const b = new Browser(srv.origin);
    const run = await toReady(b);
    const next = await say(b, "find me a backpack");
    expect(next.state).toBe("proposing");
    expect((await b.call("get_checkout", { id: run.checkoutId })).body.body.status).toBe("canceled");
  });
});

describe("agent: negotiation outcomes are handled gracefully", () => {
  it("no fulfillment extension → requires_escalation → hands off with the continue_url", async () => {
    const b = new Browser(srv.origin);
    await b.post("/api/playground/discovery/fetch", { variant: "no-fulfillment" });
    await say(b, HEADLINE);
    const run = await say(b, "yes");
    expect(run.state).toBe("idle");
    expect(run.handoffUrl).toMatch(/checkout\?continue=chk_/);
    expect(last(run)).toMatch(/continue at http/i);
    expect(kinds(run)).toContain("handoff");
  });
  it("unsupported protocol version → explains and never calls the merchant's REST API", async () => {
    const b = new Browser(srv.origin);
    await b.post("/api/playground/discovery/fetch", { variant: "old-version" });
    const run = await say(b, HEADLINE);
    expect(run.state).toBe("idle");
    expect(last(run)).toMatch(/protocol version/i);
    expect(run.timeline.at(-1)).toMatchObject({ status: "error" });
    const log = (await b.get("/api/playground/inspector/events")).body.events as { op: string; actor: string }[];
    expect(log.filter((l) => l.actor === "business" && l.op !== "get_profile")).toEqual([]);
  });
  it("checks the negotiated capabilities before using one (cart is not offered, so it is never called)", async () => {
    const b = new Browser(srv.origin);
    await b.post("/api/playground/discovery/fetch", { variant: "with-cart" });
    const run = await say(b, "add it to my cart");
    expect(last(run)).toMatch(/doesn't offer the cart capability/);
    expect(run.timeline.at(-1)).toMatchObject({ kind: "capability" });
    const log = (await b.get("/api/playground/inspector/events")).body.events as { op: string }[];
    expect(log.some((l) => l.op === "create_cart")).toBe(false);
  });
  it("discount extension not negotiated → the agent says so instead of sending codes", async () => {
    const b = new Browser(srv.origin);
    await b.post("/api/playground/discovery/fetch", { variant: "no-discount" });
    await say(b, HEADLINE);
    await say(b, "yes");
    const run = await say(b, "apply code WELCOME10");
    expect(last(run)).toMatch(/discount extension/);
  });
});

describe("agent: input handling", () => {
  it("gibberish gets a helpful reply, help works, and oversized input is rejected", async () => {
    const b = new Browser(srv.origin);
    expect(last(await say(b, "asdfgh"))).toMatch(/didn't catch that/);
    expect(last(await say(b, "help"))).toMatch(/never pay for you|can never pay/i);
    expect((await b.post("/api/playground/agent/message", { text: "x".repeat(501) })).status).toBe(400);
    expect((await b.post("/api/playground/agent/message", {})).status).toBe(400);
  });
  it("profile validation rejects bad data", async () => {
    const b = new Browser(srv.origin);
    expect((await b.post("/api/playground/agent/profile", { email: "nope" })).status).toBe(400);
  });
  it("selecting out of range or with no candidates is handled", async () => {
    const b = new Browser(srv.origin);
    await b.post("/api/playground/discovery/fetch", {});
    expect(last(await say(b, "yes"))).toMatch(/what you'd like to buy first/);
    await say(b, HEADLINE);
    expect(last(await say(b, "#3"))).toMatch(/only have/);
  });
});

describe("layering: the agent reaches the business only through UCP", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
  it("nothing under src/platform imports merchant code", () => {
    for (const f of files("src/platform").filter((x) => x.endsWith(".ts"))) expect(readFileSync(f, "utf8"), f).not.toMatch(/from ["']@\/merchant\//);
  });
  it("the agent module cannot reach the consent grant", () => {
    const src = readFileSync("src/platform/agent/agent.ts", "utf8");
    expect(src).not.toMatch(/grantConsent|consumeConsent|completeCheckout|authorizeAndComplete/);
  });
});

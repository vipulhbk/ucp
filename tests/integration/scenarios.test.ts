import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, startServer } from "./env";

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => void (srv = await startServer()));
afterAll(() => srv.close());

type R = any;
const run = async (b: Browser, id: string): Promise<{ status: number; body: R }> => b.post(`/api/playground/scenarios/${id}/run`);

/** Run a scenario to the end. Buyer steps are completed through the REAL authorize endpoint, like the UI's button. */
async function playThrough(b: Browser, id: string, cards: string[] = ["visa_ok"]) {
  const steps: R[] = [];
  let cardIdx = 0;
  for (let guard = 0; guard < 40; guard++) {
    const r = await run(b, id);
    if (r.status !== 200) return { steps, error: r.body, state: undefined };
    steps.push(r.body);
    const nb = r.body.result.needsBuyer;
    if (nb) {
      const card = cards[Math.min(cardIdx++, cards.length - 1)]!;
      const a = await b.post("/api/playground/checkout/authorize", { checkoutId: nb.checkoutId, cardId: card, expectedTotal: nb.expectedTotal });
      expect(a.status, "buyer authorization").toBe(200);
      continue; // next loop iteration verifies
    }
    if (r.body.state.done) return { steps, state: r.body.state, error: undefined };
    if (!r.body.result.ok) return { steps, state: r.body.state, error: r.body.result };
  }
  throw new Error("scenario did not finish");
}
const okSteps = (steps: R[]) => steps.filter((s) => s.result.ok);

describe("scenario library", () => {
  it("lists all seven scenarios with their protocol sequence", async () => {
    const b = new Browser(srv.origin);
    const { scenarios } = (await b.get("/api/playground/scenarios")).body;
    expect(scenarios.map((s: R) => s.id)).toEqual(["merchant-discovery", "successful-purchase", "unsupported-capability", "payment-failure", "order-lifecycle", "version-compatibility", "discount-fulfillment"]);
    for (const s of scenarios) {
      expect(s.steps.length).toBeGreaterThanOrEqual(4);
      for (const st of s.steps) expect(st.protocol.length, `${s.id}/${st.id}`).toBeGreaterThan(20);
    }
  });
  it("unknown scenario → 404 / error", async () => {
    const b = new Browser(srv.origin);
    expect((await b.get("/api/playground/scenarios/nope")).status).toBe(404);
    expect((await run(b, "nope")).status).toBe(409);
  });
});

describe("1 · merchant discovery", () => {
  it("runs all four steps with real data from the profile", async () => {
    const b = new Browser(srv.origin);
    const { steps, state } = await playThrough(b, "merchant-discovery");
    expect(state.done).toBe(true);
    expect(okSteps(steps)).toHaveLength(4);
    expect(steps[0].result.exchanges[0]).toMatchObject({ op: "get_profile", status: 200 });
    expect(steps[1].result.facts.find((f: R) => f.label === "Resolved REST endpoint").value).toBe(`${srv.origin}/api/ucp/v1`);
    expect(steps[2].result.facts.map((f: R) => f.label)).toContain("dev.ucp.shopping.checkout");
    expect(steps[3].result.facts.find((f: R) => f.label === "Simulated").value).toMatch(/yes/);
  });
});

describe("2 · successful purchase", () => {
  it("walks request → search → checkout → price → authorize → order, with every step grounded in a real exchange", async () => {
    const b = new Browser(srv.origin);
    const { steps, state } = await playThrough(b, "successful-purchase");
    expect(state.done).toBe(true);
    expect(state.data.orderId).toMatch(/^ord_/);
    expect(steps[1].result.exchanges[0]).toMatchObject({ op: "search_catalog", status: 200 });
    expect(steps[3].result.exchanges[0]).toMatchObject({ op: "create_checkout", status: 201 });
    const ids = state.results.map((r: R) => r.stepId);
    expect(ids).toEqual(["request", "search", "select", "create", "session", "update", "price", "authorize", "complete", "order", "result"]);
    expect((await b.get("/api/playground/orders")).body.orders).toHaveLength(1); // exactly one order
  });
  it("the scenario cannot authorize for the buyer: without the click the buyer step never advances", async () => {
    const b = new Browser(srv.origin);
    let r: R;
    do r = (await run(b, "successful-purchase")).body;
    while (!r.result.needsBuyer);
    expect(r.result.needsBuyer).toMatchObject({ type: "authorize", instruction: expect.stringContaining("agent cannot") });
    for (let i = 0; i < 3; i++) {
      const again = (await run(b, "successful-purchase")).body;
      expect(again.result.ok).toBe(false);
      expect(again.state.index).toBe(r.state.index); // still waiting at the same step
      expect(again.state.done).toBe(false);
    }
    expect((await b.get("/api/playground/orders")).body.orders).toEqual([]);
  });
  it("the shown total is the merchant's total", async () => {
    const b = new Browser(srv.origin);
    let r: R;
    do r = (await run(b, "successful-purchase")).body;
    while (!r.result.needsBuyer);
    const co = (await b.call("get_checkout", { id: r.result.needsBuyer.checkoutId })).body.body;
    expect(r.result.needsBuyer.expectedTotal).toBe(co.totals.find((t: R) => t.type === "total").amount);
    expect(co.line_items[0].quantity).toBe(2); // the quantity update step really changed it
  });
});

describe("3 · unsupported capability", () => {
  it("the business answers capabilities_incompatible and the agent recovers through checkout", async () => {
    const b = new Browser(srv.origin);
    const { steps, state } = await playThrough(b, "unsupported-capability");
    expect(state.done).toBe(true);
    expect(steps[1].result.exchanges[0]).toMatchObject({ op: "create_cart", status: 200, responseBody: { ucp: { status: "error" }, messages: [{ code: "capabilities_incompatible" }], continue_url: expect.any(String) } });
    expect(steps[2].result.ok).toBe(true);
    expect(steps[3].result.exchanges[0]).toMatchObject({ op: "create_checkout", status: 201 });
  });
});

describe("4 · payment failure", () => {
  it("decline → recoverable error → Update → retry with another card → one order", async () => {
    const b = new Browser(srv.origin);
    const { steps, state, error } = await playThrough(b, "payment-failure", ["visa_declined", "mc_ok"]);
    expect(error).toBeUndefined();
    expect(state.done).toBe(true);
    const failure = state.results.find((r: R) => r.stepId === "failure");
    expect(failure.facts.find((f: R) => f.label === "Charged").value).toMatch(/nothing/);
    expect(failure.exchanges[0].responseBody.messages.some((m: R) => m.code === "payment_failed")).toBe(true);
    expect(steps.length).toBeGreaterThan(6);
    expect((await b.get("/api/playground/orders")).body.orders).toHaveLength(1);
  });
  it("picking an approved card in the decline step is reported, not silently accepted", async () => {
    const b = new Browser(srv.origin);
    const { error } = await playThrough(b, "payment-failure", ["visa_ok"]);
    expect(error.summary).toMatch(/approved.*Reset/);
  });
});

describe("5 · order lifecycle", () => {
  it("order → shipped → signed webhook → verified & applied → dashboard converged", async () => {
    const b = new Browser(srv.origin);
    const { steps, state, error } = await playThrough(b, "order-lifecycle");
    expect(error).toBeUndefined();
    expect(state.done).toBe(true);
    const recv = state.results.find((r: R) => r.stepId === "receive");
    expect(recv.facts.find((f: R) => f.label === "Signature").value).toMatch(/✓ ES256/);
    const dash = state.results.find((r: R) => r.stepId === "dashboard");
    expect(dash.summary).toMatch(/converged/);
    expect(steps.length).toBeGreaterThan(5);
    const s = (await b.get("/api/playground/webhooks")).body;
    expect(s.outbox.map((r: R) => r.summary).reverse()).toEqual(["Order created", "Shipped"]);
    expect(s.receipts.filter((r: R) => r.outcome === "applied")).toHaveLength(2);
  });
});

describe("6 · version compatibility", () => {
  it("compatible, incompatible, business-side enforcement, capability skew, and restore", async () => {
    const b = new Browser(srv.origin);
    const { state, error } = await playThrough(b, "version-compatibility");
    expect(error).toBeUndefined();
    expect(state.done).toBe(true);
    const r = Object.fromEntries(state.results.map((x: R) => [x.stepId, x]));
    expect(r.incompatible.facts.find((f: R) => f.label === "Result").value).toBe("version_unsupported");
    expect(r.enforce.exchanges[0]).toMatchObject({ status: 422, responseBody: { messages: [{ code: "version_unsupported" }] } });
    expect(r.skew.facts[0].value).not.toMatch(/discount/);
    expect(r.skew.facts[1].value).toMatch(/discount.*no_mutual_version/);
    // the session is left on the compatible platform
    expect((await b.get("/api/playground/session/info")).body).toMatchObject({ variant: "default", ok: true });
  });
});

describe("7 · discount and fulfillment", () => {
  it("applies and rejects codes and computes shipping options on the merchant", async () => {
    const b = new Browser(srv.origin);
    const { state, error } = await playThrough(b, "discount-fulfillment");
    expect(error).toBeUndefined();
    expect(state.done).toBe(true);
    const r = Object.fromEntries(state.results.map((x: R) => [x.stepId, x]));
    expect(r.create.summary).toMatch(/checkout, fulfillment, discount|checkout.*discount/);
    expect(r.eligible.facts.map((f: R) => f.label)).toEqual(expect.arrayContaining(["welcome10", "FLAT500", "automatic", "rejected"]));
    expect(r.eligible.facts.find((f: R) => f.label === "rejected").value).toMatch(/discount_code_expired/);
    expect(r.fulfillment.facts.map((f: R) => f.label)).toEqual(["standard", "express"]);
    expect(r.update.summary).toMatch(/ready_for_complete/);
    expect(r.update.facts.map((f: R) => f.label)).toContain("fulfillment");
  });
});

describe("resettable and independent", () => {
  it("a finished scenario refuses more runs until reset; reset allows a clean rerun", async () => {
    const b = new Browser(srv.origin);
    await playThrough(b, "merchant-discovery");
    expect((await run(b, "merchant-discovery")).status).toBe(409);
    expect((await b.post("/api/playground/scenarios/merchant-discovery/reset")).body.ok).toBe(true);
    const st = (await b.get("/api/playground/scenarios/merchant-discovery")).body.state;
    expect(st).toMatchObject({ index: 0, done: false, results: [] });
    expect((await playThrough(b, "merchant-discovery")).state.done).toBe(true);
  });
  it("reset removes what the scenario created (orders, checkouts)", async () => {
    const b = new Browser(srv.origin);
    await playThrough(b, "successful-purchase");
    expect((await b.get("/api/playground/orders")).body.orders).toHaveLength(1);
    await b.post("/api/playground/scenarios/successful-purchase/reset");
    expect((await b.get("/api/playground/orders")).body.orders).toEqual([]);
  });
  it("scenarios are independent: each starts from its own first step, in any order", async () => {
    const b = new Browser(srv.origin);
    await playThrough(b, "unsupported-capability");
    expect((await b.get("/api/playground/scenarios/merchant-discovery")).body.state.index).toBe(0);
    expect((await playThrough(b, "merchant-discovery")).state.done).toBe(true);
  });
  it("visitors are isolated from each other", async () => {
    const a = new Browser(srv.origin);
    const c = new Browser(srv.origin);
    await playThrough(a, "merchant-discovery");
    expect((await c.get("/api/playground/scenarios/merchant-discovery")).body.state.index).toBe(0);
  });
});

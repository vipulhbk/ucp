import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, startServer } from "./env";

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => void (srv = await startServer()));
afterAll(() => srv.close());

type R = any;
const addr = { type: "shipping_address", id: "dest_1", street_address: "12 MG Road", address_locality: "Bengaluru", address_region: "KA", postal_code: "560001", address_country: "IN" };

/** A realistic session: discovery, search, checkout, a rejected invalid call, authorization, order. */
async function session() {
  const b = new Browser(srv.origin);
  await b.post("/api/playground/discovery/fetch", {});
  await b.call("search_catalog", { body: { query: "headphones", filters: { price: { max: 500000 } } } });
  const c = (await b.call("create_checkout", { body: { line_items: [{ item: { id: "var_aurora_anc" }, quantity: 1 }] } })).body.body;
  await b.call("create_checkout", { body: { line_items: [{ item: { id: "x" }, quantity: 0 }] }, skipValidation: true }); // 400 from the business
  const u = (await b.call("update_checkout", { id: c.id, body: { line_items: [{ id: "li_1", item: { id: "var_aurora_anc" }, quantity: 1 }], buyer: { email: "asha@example.com", first_name: "Asha" }, fulfillment: { methods: [{ id: "method_1", type: "shipping", line_item_ids: ["li_1"], destinations: [addr], selected_destination_id: "dest_1", groups: [{ id: "group_1", selected_option_id: "standard" }] }] } } })).body.body;
  const total = u.totals.find((t: R) => t.type === "total").amount;
  await b.post("/api/playground/checkout/authorize", { checkoutId: c.id, cardId: "visa_ok", expectedTotal: total });
  return { b, checkoutId: c.id as string, total };
}
const events = async (b: Browser, qs = ""): Promise<R> => (await b.get(`/api/playground/inspector/events${qs}`)).body;
const settle = async (b: Browser) => {
  for (let i = 0; i < 40; i++) {
    const s = (await b.get("/api/playground/webhooks")).body;
    if (s.outbox.length && s.outbox.every((r: R) => r.status !== "pending") && s.receipts.every((r: R) => r.outcome !== "pending")) return s;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("webhooks did not settle");
};

describe("captured fields (every interaction, both ends)", () => {
  it("records timestamp, actor, method, endpoint, headers, bodies, status, duration, validation, correlation id and errors", async () => {
    const { b } = await session();
    const { events: ev } = await events(b);
    const create = ev.find((e: R) => e.actor === "platform" && e.op === "create_checkout" && e.status === 201);
    expect(create).toMatchObject({ method: "POST", status: 201, correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/), actor: "platform" });
    expect(create.url).toMatch(/\/api\/ucp\/v1\/checkout-sessions$/);
    expect(Date.parse(create.ts)).not.toBeNaN();
    expect(create.durationMs).toBeGreaterThanOrEqual(0);
    expect(create.requestHeaders["ucp-agent"]).toContain("profile=");
    expect(create.requestHeaders["idempotency-key"]).toBeTruthy();
    expect(create.requestBody).toMatchObject({ line_items: [{ quantity: 1 }] });
    expect(create.responseHeaders["request-id"]).toBe(create.correlationId);
    expect(create.responseBody.id).toMatch(/^chk_/);
    expect(create.validation.map((v: R) => [v.target, v.ok])).toEqual([["request", true], ["response", true]]);
    const bad = ev.find((e: R) => e.actor === "business" && e.op === "create_checkout" && e.status === 400);
    expect(bad.validation[0]).toMatchObject({ ok: false, target: "request", issues: [{ path: "$.line_items[0].quantity" }] });
  });
  it("every platform call has a matching business record with the same Request-Id", async () => {
    const { b } = await session();
    await settle(b); // webhook deliveries log on the sender only after the receiver has answered
    const { events: ev } = await events(b);
    for (const e of ev.filter((x: R) => x.actor === "platform" && x.op !== "get_profile" && x.op !== "tokenize" && x.status !== undefined)) {
      expect(ev.some((x: R) => x.actor === "business" && x.correlationId === e.correlationId), `${e.op} ${e.correlationId}`).toBe(true);
    }
  });
  it("is chronological", async () => {
    const { b } = await session();
    const { events: ev } = await events(b);
    const ts = ev.map((e: R) => e.ts);
    expect(ts).toEqual([...ts].sort());
  });
  it("includes the credential provider's tokenize exchange, labelled simulated", async () => {
    const { b } = await session();
    const tok = (await events(b, "?actor=credential_provider")).events;
    expect(tok).toHaveLength(1);
    expect(tok[0]).toMatchObject({ op: "tokenize", status: 200 });
    expect(tok[0].note).toMatch(/SIMULATED/);
  });
});

describe("webhook deliveries are interactions too: both ends, joined by Webhook-Id", () => {
  it("records the sender's POST and the receiver's verdict", async () => {
    const { b } = await session();
    await settle(b);
    const wh = (await events(b, "?op=order_event_webhook")).events;
    const sent = wh.find((e: R) => e.actor === "business");
    const got = wh.find((e: R) => e.actor === "platform");
    expect(sent.correlationId).toBe(got.correlationId);
    expect(sent.requestHeaders["signature-input"]).toContain("keyid=");
    expect(sent.requestHeaders["webhook-id"]).toBe(sent.correlationId);
    expect(sent.status).toBe(200);
    expect(got.note).toMatch(/Accepted: signature verified/);
    expect(got.validation[0]).toMatchObject({ schema: "Order (webhook payload)", ok: true });
    expect(sent.responseBody).toMatchObject({ ucp: { version: "2026-08-25" } });
  });
  it("security demos are labelled on the sender and shown as REJECTED on the receiver", async () => {
    const { b } = await session();
    const s = await settle(b);
    await b.post("/api/playground/webhooks/send", { rowId: s.outbox[0].id, mode: "tamper_body" });
    const wh = (await events(b, "?op=order_event_webhook&status=client_error")).events;
    expect(wh.find((e: R) => e.actor === "business").note).toMatch(/SECURITY DEMO \(tamper_body\)/);
    const rec = wh.find((e: R) => e.actor === "platform");
    expect(rec.note).toMatch(/REJECTED by the receiver: digest_mismatch/);
    expect(rec.status).toBe(400);
  });
  it("webhook entries are not replayable", async () => {
    const { b } = await session();
    await settle(b);
    const e = (await events(b, "?op=order_event_webhook")).events[0];
    expect((await b.post("/api/playground/inspector/replay", { id: e.id })).status).toBe(409);
  });
});

describe("filters", () => {
  it("by actor, by operation, by status class, by text, by correlation id; and they combine", async () => {
    const { b } = await session();
    await settle(b);
    const all = await events(b);
    expect(all.events.length).toBeGreaterThan(10);
    expect((await events(b, "?actor=business")).events.every((e: R) => e.actor === "business")).toBe(true);
    expect((await events(b, "?actor=platform,business")).events.length).toBeLessThan(all.events.length); // credential provider excluded
    expect((await events(b, "?op=create_checkout")).events.every((e: R) => e.op === "create_checkout")).toBe(true);
    expect((await events(b, "?op=create_checkout,update_checkout")).events.map((e: R) => e.op)).toEqual(expect.arrayContaining(["create_checkout", "update_checkout"]));
    const client = (await events(b, "?status=client_error")).events;
    expect(client.length).toBeGreaterThan(0);
    expect(client.every((e: R) => e.status >= 400 && e.status < 500)).toBe(true);
    expect((await events(b, "?status=ok")).events.every((e: R) => e.status < 400)).toBe(true);
    const inv = (await events(b, "?status=invalid")).events;
    expect(inv.length).toBeGreaterThan(0);
    expect(inv.every((e: R) => e.validation.some((v: R) => !v.ok))).toBe(true);
    expect((await events(b, "?q=checkout-sessions")).events.every((e: R) => /checkout-sessions/.test(e.url))).toBe(true);
    const cid = all.events.find((e: R) => e.op === "update_checkout").correlationId;
    const pair = (await events(b, `?correlation=${cid}`)).events;
    expect(pair.map((e: R) => e.actor).sort()).toEqual(["business", "platform"]);
    expect((await events(b, "?actor=business&op=update_checkout&status=ok")).events).toHaveLength(1);
  });
  it("facets list what exists in the unfiltered log, so controls never lose options", async () => {
    const { b } = await session();
    const r = await events(b, "?actor=credential_provider");
    expect(r.events).toHaveLength(1);
    expect(r.facets.actors.map((a: R) => a.name)).toEqual(expect.arrayContaining(["platform", "business", "credential_provider"]));
    expect(r.facets.ops.map((o: R) => o.name)).toEqual(expect.arrayContaining(["create_checkout", "update_checkout", "search_catalog", "tokenize"]));
  });
  it("summary counts failures, validation failures and distinct correlation ids", async () => {
    const { b } = await session();
    const { summary } = await events(b);
    expect(summary.total).toBeGreaterThan(10);
    expect(summary.failures).toBeGreaterThanOrEqual(2); // the 400 on both ends
    expect(summary.validationFailures).toBeGreaterThanOrEqual(1);
    expect(summary.correlated).toBeLessThan(summary.total); // both ends share ids
    expect(summary.avgDurationMs).toBeGreaterThanOrEqual(0);
  });
  it("ignores junk filter values instead of failing, and limits", async () => {
    const { b } = await session();
    expect((await b.get("/api/playground/inspector/events?status=nonsense&limit=abc")).status).toBe(200);
    expect((await events(b, "?limit=3")).events).toHaveLength(3);
  });
});

describe("export", () => {
  it("downloads NDJSON: a metadata line, then one redacted interaction per line, honoring filters", async () => {
    const { b } = await session();
    const r = await b.getText("/api/playground/inspector/export");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/x-ndjson");
    expect(r.headers.get("content-disposition")).toContain("ucp-session-log.ndjson");
    const lines = r.text.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: "meta", ucpVersion: "2026-08-25", note: expect.stringContaining("Redacted") });
    expect(lines[0].count).toBe(lines.length - 1);
    expect(lines.slice(1).every((l: R) => l.type === "interaction" && l.actor && l.op)).toBe(true);
    const only = (await b.getText("/api/playground/inspector/export?actor=business&op=update_checkout")).text.trim().split("\n").map((l) => JSON.parse(l));
    expect(only).toHaveLength(2);
    expect(only[1]).toMatchObject({ actor: "business", op: "update_checkout" });
  });
});

describe("no secrets and no personal data in any output", () => {
  it("events API, export and exchange payloads contain no credentials, tokens, card numbers, raw PII, or the session id", async () => {
    const { b } = await session();
    await settle(b);
    const api = JSON.stringify((await events(b)).events);
    const exp = (await b.getText("/api/playground/inspector/export")).text;
    const sid = b.cookieValue;
    expect(sid).toMatch(/^[a-f0-9]{32}$/);
    for (const [name, text] of [["events", api], ["export", exp]] as const) {
      expect(text, `${name}: platform API key`).not.toMatch(/plk_[a-f0-9]{24}\./);
      expect(text, `${name}: payment token`).not.toMatch(/tok_[A-Za-z0-9_-]{12,}/);
      expect(text, `${name}: card number`).not.toContain("4242424242424242");
      expect(text, `${name}: raw email`).not.toContain("asha@example.com");
      expect(text, `${name}: session id (the HttpOnly cookie secret)`).not.toContain(sid);
      expect(text, `${name}: sid field`).not.toMatch(/"sid"\s*:/);
      expect(text, `${name}: raw street`).not.toContain("12 MG Road");
    }
    expect(api).toContain("[REDACTED]");
    // public signature material stays visible: it is needed to explain verification
    expect(exp).toMatch(/"signature-input"/);
  });
  it("the exchange objects returned by call routes carry no session id either", async () => {
    const b = new Browser(srv.origin);
    await b.post("/api/playground/discovery/fetch", {});
    const r = await b.call("search_catalog", { body: { query: "mouse" } });
    expect(JSON.stringify(r.body)).not.toContain(b.cookieValue);
    expect(r.body.exchange).not.toHaveProperty("sid");
  });
  it("visitors only ever see their own interactions", async () => {
    const a = (await session()).b;
    const c = new Browser(srv.origin);
    const mine = JSON.stringify((await events(a)).events);
    const theirs = (await events(c)).events;
    expect(theirs).toEqual([]);
    expect(mine.length).toBeGreaterThan(100);
  });
});

describe("replay (read-only operations only)", () => {
  it("replays Get Checkout, returns a fresh exchange tagged as a replay, and reports identical state", async () => {
    const { b, checkoutId } = await session();
    await b.call("get_checkout", { id: checkoutId });
    const rec = (await events(b, "?actor=platform&op=get_checkout")).events.at(-1);
    const r = await b.post("/api/playground/inspector/replay", { id: rec.id });
    expect(r.status).toBe(200);
    expect(r.body.replayed.note).toMatch(/Replay of/);
    expect(r.body.replayed.id).not.toBe(rec.id);
    expect(r.body.replayed.correlationId).not.toBe(rec.correlationId);
    expect(r.body.identical).toBe(true);
    expect(r.body.differences).toEqual([]);
    // the replay itself is in the log, on both sides
    const replayCid = r.body.replayed.correlationId;
    expect((await events(b, `?correlation=${replayCid}`)).events.map((e: R) => e.actor).sort()).toEqual(["business", "platform"]);
  });
  it("replays search and lookup (read-only POSTs) with the recorded body", async () => {
    const { b } = await session();
    const rec = (await events(b, "?actor=platform&op=search_catalog")).events[0];
    const r = await b.post("/api/playground/inspector/replay", { id: rec.id });
    expect(r.status).toBe(200);
    expect(r.body.replayed.requestBody).toEqual(rec.requestBody);
    expect(r.body.identical).toBe(true);
  });
  it("replays the profile fetch", async () => {
    const { b } = await session();
    const rec = (await events(b, "?actor=platform&op=get_profile")).events[0];
    const r = await b.post("/api/playground/inspector/replay", { id: rec.id });
    expect(r.status).toBe(200);
    expect(r.body.replayed).toMatchObject({ op: "get_profile", status: 200 });
    expect(r.body.identical).toBe(true);
  });
  it("detects that state changed between the original and the replay", async () => {
    const b = new Browser(srv.origin);
    await b.post("/api/playground/discovery/fetch", {});
    const c = (await b.call("create_checkout", { body: { line_items: [{ item: { id: "var_glide_mouse" }, quantity: 1 }] } })).body.body;
    await b.call("get_checkout", { id: c.id });
    const rec = (await events(b, "?actor=platform&op=get_checkout")).events.at(-1);
    await b.call("update_checkout", { id: c.id, body: { line_items: [{ id: "li_1", item: { id: "var_glide_mouse" }, quantity: 3 }] } });
    const r = await b.post("/api/playground/inspector/replay", { id: rec.id });
    expect(r.body.identical).toBe(false);
    expect(r.body.differences.some((d: string) => /line_items|totals/.test(d))).toBe(true);
  });
  it("refuses state-changing operations, with the reason", async () => {
    const { b } = await session();
    for (const op of ["create_checkout", "update_checkout", "complete_checkout"]) {
      const rec = (await events(b, `?actor=platform&op=${op}`)).events[0];
      if (!rec) continue;
      const r = await b.post("/api/playground/inspector/replay", { id: rec.id });
      expect(r.status, op).toBe(409);
      expect(r.body.error).toMatchObject({ kind: "not_replayable", message: expect.stringContaining("redacted log cannot faithfully reproduce") });
    }
    const orders = (await b.get("/api/playground/orders")).body.orders;
    expect(orders).toHaveLength(1); // nothing was duplicated by the refused replays
  });
  it("refuses business-side records, unknown ids, and malformed requests; never replays another visitor's record", async () => {
    const { b } = await session();
    const biz = (await events(b, "?actor=business&op=get_checkout")).events[0];
    expect((await b.post("/api/playground/inspector/replay", { id: biz.id })).status).toBe(409);
    expect((await b.post("/api/playground/inspector/replay", { id: "nope" })).status).toBe(404);
    expect((await b.post("/api/playground/inspector/replay", {})).status).toBe(400);
    const other = new Browser(srv.origin);
    expect((await other.post("/api/playground/inspector/replay", { id: biz.id })).status).toBe(404);
  });
});

describe("validator API (BFF)", () => {
  it("lists targets with examples and the scope statement", async () => {
    const b = new Browser(srv.origin);
    const r = (await b.get("/api/playground/validator/targets")).body;
    expect(r.targets).toHaveLength(10);
    expect(r.scope).toMatch(/does NOT test protocol behavior/);
    expect(r.targets.every((t: R) => t.examples.valid && t.examples.invalid.length >= 1)).toBe(true);
    expect(r.opTargets.create_checkout).toEqual({ request: "checkout_create_request", response: "checkout_response" });
  });
  it("validates text and returns paths; unknown targets 404; bad input 400", async () => {
    const b = new Browser(srv.origin);
    const r = await b.post("/api/playground/validator/validate", { target: "checkout_create_request", payload: '{"line_items":[{"item":{"id":"x"},"quantity":0}]}' });
    expect(r.body.schema.issues[0]).toMatchObject({ path: "$.line_items[0].quantity" });
    expect((await b.post("/api/playground/validator/validate", { target: "nope", payload: "{}" })).status).toBe(404);
    expect((await b.post("/api/playground/validator/validate", { target: "order" })).status).toBe(400);
    expect((await b.post("/api/playground/validator/validate", { target: "order", payload: "{bad" })).body.parse.ok).toBe(false);
  });
  it("serves the official source schema for a target", async () => {
    const b = new Browser(srv.origin);
    const r = (await b.get("/api/playground/validator/schema/checkout_response")).body;
    expect(r.url).toMatch(/ucp\.dev\/2026-08-25\/schemas\/shopping\/checkout\.json/);
    expect(r.schema.title).toBe("Checkout");
    expect((await b.get("/api/playground/validator/schema/nope")).status).toBe(404);
  });
  it("REAL recorded bodies from the inspector validate against their schemas (the validator and the implementation agree)", async () => {
    const { b } = await session();
    await settle(b);
    const { events: ev } = await events(b);
    const t = (await b.get("/api/playground/validator/targets")).body.opTargets as Record<string, { request?: string; response?: string }>;
    let checked = 0;
    for (const e of ev) {
      for (const dir of ["request", "response"] as const) {
        const target = t[e.op]?.[dir];
        const body = dir === "request" ? e.requestBody : e.responseBody;
        if (!target || body === undefined) continue;
        if (e.status && e.status >= 400) continue; // error bodies are validated against error_response elsewhere
        const r = (await b.post("/api/playground/validator/validate", { target, payload: JSON.stringify(body) })).body;
        expect(r.schema.issues, `${e.actor}:${e.op} ${dir} → ${target}`).toEqual([]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(8);
  });
});

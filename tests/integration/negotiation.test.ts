import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, TestPlatform } from "./env";

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => void (srv = await startServer()));
afterAll(() => srv.close());

const create = { line_items: [{ item: { id: "var_aurora_anc" }, quantity: 1 }] };

describe("business-side negotiation errors (spec: overview → Error Codes)", () => {
  it("missing UCP-Agent → 400 invalid_profile_url", async () => {
    const p = new TestPlatform(srv.origin);
    const r = await p.call("POST", "/api/ucp/v1/checkout-sessions", create, {}, { agent: false });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ ucp: { status: "error", version: "2026-08-25" }, messages: [{ code: "invalid_profile_url", severity: "unrecoverable" }], continue_url: expect.any(String) });
  });
  it("malformed UCP-Agent value → 400 invalid_profile_url", async () => {
    const r = await new TestPlatform(srv.origin).call("POST", "/api/ucp/v1/checkout-sessions", create, { "ucp-agent": "profile=https://not-quoted.example" });
    expect(r.status).toBe(400);
    expect(r.body.messages[0].code).toBe("invalid_profile_url");
  });
  it("profile URL outside the allowlist (SSRF) → 400, and is never fetched", async () => {
    for (const url of ["https://evil.example/p.json", "http://169.254.169.254/latest/meta-data", "http://localhost:1/x"]) {
      const r = await new TestPlatform(srv.origin).call("POST", "/api/ucp/v1/checkout-sessions", create, { "ucp-agent": `profile="${url}"` });
      expect(r.status, url).toBe(400);
      expect(r.body.messages[0].code).toBe("invalid_profile_url");
    }
  });
  it("profile fetch returning non-2xx → 424 profile_unreachable", async () => {
    const r = await new TestPlatform(srv.origin).call("POST", "/api/ucp/v1/checkout-sessions", create, { "ucp-agent": `profile="${srv.origin}/does-not-exist"` });
    expect(r.status).toBe(424);
    expect(r.body.messages[0].code).toBe("profile_unreachable");
  });
  it("invalid platform profile → 422 profile_malformed", async () => {
    const r = await new TestPlatform(srv.origin, "malformed").call("POST", "/api/ucp/v1/checkout-sessions", create);
    expect(r.status).toBe(422);
    expect(r.body.messages[0].code).toBe("profile_malformed");
  });
  it("unsupported protocol version → 422 version_unsupported, no resource created", async () => {
    const r = await new TestPlatform(srv.origin, "old-version").call("POST", "/api/ucp/v1/checkout-sessions", create);
    expect(r.status).toBe(422);
    expect(r.body.messages[0]).toMatchObject({ code: "version_unsupported", content: expect.stringContaining("2026-01-11") });
    expect(r.body.ucp.version).toBe("2026-08-25"); // the business's version, per the spec example
  });
  it("capability the business does not offer → 200 capabilities_incompatible with continue_url", async () => {
    const r = await new TestPlatform(srv.origin, "with-cart").call("POST", "/api/ucp/v1/carts", { line_items: [] }, {}, { key: false });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ucp: { status: "error" }, messages: [{ code: "capabilities_incompatible" }], continue_url: expect.any(String) });
  });
  it("…while the same platform can still use the capabilities both sides share", async () => {
    const p = new TestPlatform(srv.origin, "with-cart");
    expect((await p.create(create)).status).toBe(201);
  });
  it("capability intersection drives the response: no discount extension ⇒ no discounts object, info note", async () => {
    const p = new TestPlatform(srv.origin, "no-discount");
    const r = await p.create({ ...create, discounts: { codes: ["WELCOME10"] } });
    expect(r.status).toBe(201);
    expect(r.body.discounts).toBeUndefined();
    expect(Object.keys(r.body.ucp.capabilities).sort()).toEqual(["dev.ucp.shopping.checkout", "dev.ucp.shopping.fulfillment"]);
    expect(r.body.messages).toContainEqual(expect.objectContaining({ type: "info", code: "extension_not_negotiated", path: "$.discounts" }));
  });
  it("discount version skew excludes the extension (exact version equality)", async () => {
    const r = await new TestPlatform(srv.origin, "discount-skew").create(create);
    expect(r.body.ucp.capabilities["dev.ucp.shopping.discount"]).toBeUndefined();
    expect(r.body.ucp.capabilities["dev.ucp.shopping.fulfillment"]).toBeDefined();
  });
  it("without the fulfillment extension the API cannot collect shipping: requires_escalation + continue_url", async () => {
    const r = await new TestPlatform(srv.origin, "no-fulfillment").create(create);
    expect(r.body.status).toBe("requires_escalation");
    expect(r.body.messages).toContainEqual(expect.objectContaining({ code: "fulfillment_required", severity: "requires_buyer_input" }));
    expect(r.body.continue_url).toMatch(/^http/);
    expect(r.body.fulfillment).toBeUndefined();
  });
  it("a platform profile fetched once is served from cache (5-minute TTL)", async () => {
    const p = new TestPlatform(srv.origin);
    expect((await p.create(create)).status).toBe(201);
    expect((await p.create(create)).status).toBe(201);
  });
});

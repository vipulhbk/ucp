import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRODUCTS } from "@/merchant/catalog/data";
import { startServer, TestPlatform } from "./env";

let srv: Awaited<ReturnType<typeof startServer>>;
let p: TestPlatform;
beforeAll(async () => {
  srv = await startServer();
  p = new TestPlatform(srv.origin);
});
afterAll(() => srv.close());

describe("catalog search / lookup over UCP REST", () => {
  it("search is open (no API key) and requires only UCP-Agent negotiation", async () => {
    const r = await p.call("POST", "/api/ucp/v1/catalog/search", { query: "wireless headphone with noise cancellation", filters: { price: { max: 500000 } } }, {}, { key: false });
    expect(r.status).toBe(200);
    expect(r.body.products[0].id).toBe("prod_aurora_anc");
    expect(r.body.products[0].variants[0]).toMatchObject({ id: "var_aurora_anc", price: { amount: 449900, currency: "INR" }, availability: { available: true } });
    expect(r.body.products.every((x: any) => x.price_range.max.amount <= 500000)).toBe(true);
  });
  it("echoes only the relevant capability and the negotiated version", async () => {
    const r = await p.call("POST", "/api/ucp/v1/catalog/search", { query: "speaker" }, {}, { key: false });
    expect(Object.keys(r.body.ucp.capabilities)).toEqual(["dev.ucp.shopping.catalog.search"]);
    expect(r.body.ucp.version).toBe("2026-08-25");
  });
  it("paginates with a cursor", async () => {
    const a = await p.call("POST", "/api/ucp/v1/catalog/search", { pagination: { limit: 3 } }, {}, { key: false });
    expect(a.body.pagination).toMatchObject({ has_next_page: true, total_count: PRODUCTS.length });
    const b = await p.call("POST", "/api/ucp/v1/catalog/search", { pagination: { limit: 3, cursor: a.body.pagination.cursor } }, {}, { key: false });
    expect(b.body.products[0].id).not.toBe(a.body.products[0].id);
  });
  it("lookup returns known products and omits unknown ids", async () => {
    const r = await p.call("POST", "/api/ucp/v1/catalog/lookup", { ids: ["var_glide_mouse", "nope"] }, {}, { key: false });
    expect(r.status).toBe(200);
    expect(r.body.products.map((x: any) => x.id)).toEqual(["prod_glide_mouse"]);
    expect(r.body.products[0].variants[0].inputs).toEqual([{ id: "var_glide_mouse", match: "exact" }]);
  });
  it("rejects oversized batches with 400 request_too_large", async () => {
    const r = await p.call("POST", "/api/ucp/v1/catalog/lookup", { ids: Array.from({ length: 51 }, (_, i) => `id_${i}`) }, {}, { key: false });
    expect(r.status).toBe(400);
    expect(r.body.messages[0].code).toBe("request_too_large");
  });
  it("hides delisted products from search", async () => {
    const r = await p.call("POST", "/api/ucp/v1/catalog/search", { query: "retro cd" }, {}, { key: false });
    expect(r.body.products).toHaveLength(0);
  });
  it("rejects malformed requests with JSON paths", async () => {
    const r = await p.call("POST", "/api/ucp/v1/catalog/lookup", { ids: [] }, {}, { key: false });
    expect(r.status).toBe(400);
    expect(r.body.messages[0]).toMatchObject({ type: "error", code: "invalid_request", path: "$.ids" });
  });
  it("echoes Request-Id", async () => {
    const r = await p.call("POST", "/api/ucp/v1/catalog/search", { query: "x" }, { "request-id": "11111111-1111-4111-8111-111111111111" }, { key: false });
    expect(r.headers.get("request-id")).toBe("11111111-1111-4111-8111-111111111111");
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@/persistence/memory";
import { Recorder } from "@/observability/recorder";
import { UcpClient, UcpClientError } from "@/platform/ucp-client";
import { parseUcpAgent } from "@/ucp/ucp-agent";
import { verifyApiKey } from "@/ucp/platform-credential";
import { getConfig } from "@/config";
import { serve } from "./helpers";
import { startServer, TestPlatform } from "./env";

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => void (srv = await startServer()));
afterAll(() => srv.close());

function clientFor(origin: string, endpoint = `${origin}/api/ucp/v1`, over: Partial<ConstructorParameters<typeof UcpClient>[0]> = {}) {
  const tp = new TestPlatform(origin);
  const store = new MemoryStore();
  const recorder = new Recorder(store);
  const client = new UcpClient({ sid: tp.sid, endpoint, platformProfileUrl: tp.profileUrl, apiKey: tp.apiKey, recorder, fetchOptions: { allowedOrigins: [origin], devLoopbackHosts: ["localhost"] }, sleep: async () => {}, ...over });
  return { client, recorder, tp };
}

describe("UCP client against the real business", () => {
  it("sends spec headers: UCP-Agent (RFC 8941), Request-Id, Idempotency-Key on state changes, platform credential", async () => {
    const { client, tp } = clientFor(srv.origin);
    const r = await client.createCheckout({ line_items: [{ item: { id: "var_glide_mouse" }, quantity: 1 }] });
    expect(r.status).toBe(201);
    const h = r.exchange.requestHeaders;
    expect(parseUcpAgent(h["ucp-agent"])).toEqual({ ok: true, profile: tp.profileUrl });
    expect(h["request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(h["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(h["x-api-key"]).toBe("[REDACTED]"); // recorded redacted…
    expect(verifyApiKey(getConfig().serverSecret, tp.apiKey)).toBe(tp.platformId); // …but a valid credential was actually sent (the call was authenticated)
    expect(r.body).toMatchObject({ id: expect.any(String) });
  });
  it("GET requests carry no Idempotency-Key", async () => {
    const { client } = clientFor(srv.origin);
    const r = await client.searchCatalog({ query: "mouse" });
    expect(r.exchange.requestHeaders["idempotency-key"]).toBeUndefined();
  });
  it("validates the request locally and throws before any network call", async () => {
    const { client, recorder, tp } = clientFor(srv.origin);
    await expect(client.createCheckout({ line_items: [{ item: { id: "x" }, quantity: 0 }] })).rejects.toMatchObject({ kind: "validation", issues: [{ path: "$.line_items[0].quantity" }] });
    expect(await recorder.list(tp.sid)).toHaveLength(0);
  });
  it("can bypass local validation so the business's own validation errors are visible", async () => {
    const { client } = clientFor(srv.origin);
    const r = await client.createCheckout({ line_items: [{ item: { id: "x" }, quantity: 0 }] }, { skipRequestValidation: true });
    expect(r.status).toBe(400);
    expect(r.exchange.responseBody).toMatchObject({ messages: [{ path: "$.line_items[0].quantity" }] });
  });
  it("validates responses with the official schemas and records the verdict", async () => {
    const { client } = clientFor(srv.origin);
    const r = await client.createCheckout({ line_items: [{ item: { id: "var_glide_mouse" }, quantity: 1 }] });
    expect(r.validation.map((v) => [v.target, v.ok])).toEqual([["request", true], ["response", true]]);
    const err = await client.createCheckout({ line_items: [{ item: { id: "var_nova_lamp_limited" }, quantity: 1 }] });
    expect(err.validation.find((v) => v.target === "response")).toMatchObject({ schema: "ErrorResponse", ok: true });
  });
  it("flags a non-conforming business response as a failed validation", async () => {
    const bad = await serve({ "/ucp/checkout-sessions/:id": () => Response.json({ id: "chk_x", status: "banana" }) });
    try {
      const { client } = clientFor(bad.origin, `${bad.origin}/ucp`);
      const r = await client.getCheckout("chk_x");
      const v = r.validation.find((x) => x.target === "response")!;
      expect(v.ok).toBe(false);
      expect(v.issues.some((i) => i.path === "$.status")).toBe(true);
    } finally {
      await bad.close();
    }
  });
  it("refuses endpoints outside the allowlist (the endpoint came from a profile, so it is untrusted)", async () => {
    const { client } = clientFor(srv.origin, "https://evil.example/ucp");
    await expect(client.searchCatalog({ query: "x" })).rejects.toMatchObject({ kind: "unsafe_url" });
  });
});

describe("retries", () => {
  function flaky(failures: number, status = 503) {
    const seen: { method: string; key: string | null }[] = [];
    let n = 0;
    return {
      seen,
      handler: (req: Request) => {
        seen.push({ method: req.method, key: req.headers.get("idempotency-key") });
        return n++ < failures ? new Response("down", { status, headers: { "retry-after": "0" } }) : Response.json({ ucp: { version: "2026-08-25" }, products: [], pagination: { has_next_page: false } });
      },
    };
  }
  it("retries GET on 503 and succeeds", async () => {
    const f = flaky(2);
    const s = await serve({ "/ucp/orders/:id": f.handler });
    try {
      const { client } = clientFor(s.origin, `${s.origin}/ucp`);
      const r = await client.getOrder("o1");
      expect(r.status).toBe(200);
      expect(r.attempts).toBe(3);
      expect(f.seen).toHaveLength(3);
      expect(r.exchange.note).toContain("3 attempts");
    } finally {
      await s.close();
    }
  });
  it("retries an idempotent POST with the SAME Idempotency-Key", async () => {
    const f = flaky(1);
    const s = await serve({ "/ucp/checkout-sessions": f.handler });
    try {
      const { client } = clientFor(s.origin, `${s.origin}/ucp`);
      await client.createCheckout({ line_items: [{ item: { id: "var_glide_mouse" }, quantity: 1 }] });
      expect(f.seen).toHaveLength(2);
      expect(f.seen[0]!.key).toBeTruthy();
      expect(f.seen[1]!.key).toBe(f.seen[0]!.key);
    } finally {
      await s.close();
    }
  });
  it("does NOT retry unsafe requests (POST without an idempotency key)", async () => {
    const f = flaky(1);
    const s = await serve({ "/ucp/catalog/search": f.handler });
    try {
      const { client } = clientFor(s.origin, `${s.origin}/ucp`);
      const r = await client.searchCatalog({ query: "x" });
      expect(r.status).toBe(503);
      expect(f.seen).toHaveLength(1);
    } finally {
      await s.close();
    }
  });
  it("never retries 4xx other than 429", async () => {
    const f = flaky(5, 400);
    const s = await serve({ "/ucp/orders/:id": f.handler });
    try {
      const { client } = clientFor(s.origin, `${s.origin}/ucp`);
      expect((await client.getOrder("o1")).status).toBe(400);
      expect(f.seen).toHaveLength(1);
    } finally {
      await s.close();
    }
  });
  it("gives up after maxRetries and surfaces a typed network error", async () => {
    const { client } = clientFor("http://localhost:1", "http://localhost:1/ucp", { fetchOptions: { allowedOrigins: ["http://localhost:1"], devLoopbackHosts: ["localhost"] } });
    await expect(client.getOrder("o1")).rejects.toBeInstanceOf(UcpClientError);
    await expect(client.getOrder("o1")).rejects.toMatchObject({ kind: "network" });
  });
  it("times out slow servers", async () => {
    const s = await serve({ "/ucp/orders/:id": () => new Promise<Response>((r) => setTimeout(() => r(Response.json({})), 400)) });
    try {
      const { client } = clientFor(s.origin, `${s.origin}/ucp`, { timeoutMs: 50, maxRetries: 0 });
      await expect(client.getOrder("o1")).rejects.toMatchObject({ kind: "timeout" });
    } finally {
      await s.close();
    }
  });
  it("lost-response recovery: the identical request with the same key returns the original result", async () => {
    const { client } = clientFor(srv.origin);
    const key = randomUUID();
    const body = { line_items: [{ item: { id: "var_glide_mouse" }, quantity: 1 }] };
    const a = await client.createCheckout(body, { idempotencyKey: key });
    const b = await client.createCheckout(body, { idempotencyKey: key });
    expect((b.body as { id: string }).id).toBe((a.body as { id: string }).id);
    expect(b.headers["idempotent-replayed"]).toBe("true");
  });
});

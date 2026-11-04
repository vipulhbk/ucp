import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { safeFetch, SafeFetchError } from "@/ucp/safe-fetch";

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/redirect") (res.statusCode = 302), res.setHeader("location", "http://169.254.169.254/"), res.end();
    else if (req.url === "/big") res.end("x".repeat(10_000));
    else if (req.url === "/slow") setTimeout(() => res.end("late"), 500);
    else res.setHeader("content-type", "application/json"), res.end('{"ok":true}');
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const dev = { devLoopbackHosts: ["localhost"] };
const code = async (p: Promise<unknown>) => ((await p.catch((e) => e)) as SafeFetchError).code;

describe("safeFetch", () => {
  it("fetches an allowlisted dev-loopback URL", async () => {
    const r = await safeFetch(`${base}/ok`, { ...dev, allowedOrigins: [base] });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.bodyText)).toEqual({ ok: true });
  });
  it("rejects http outside dev loopback", async () => expect(await code(safeFetch(`${base}/ok`))).toBe("scheme_not_allowed"));
  it("rejects origins outside the allowlist", async () => expect(await code(safeFetch(`${base}/ok`, { ...dev, allowedOrigins: ["https://other.example"] }))).toBe("not_allowlisted"));
  it("rejects userinfo", async () => expect(await code(safeFetch("https://ucp.dev@evil.example/x"))).toBe("userinfo_not_allowed"));
  it("does not follow redirects", async () => expect(await code(safeFetch(`${base}/redirect`, dev))).toBe("redirect"));
  it("enforces a response size cap", async () => expect(await code(safeFetch(`${base}/big`, { ...dev, maxBytes: 1000 }))).toBe("too_large"));
  it("enforces a timeout", async () => expect(await code(safeFetch(`${base}/slow`, { ...dev, timeoutMs: 100 }))).toBe("timeout"));
  it("blocks hosts that resolve to private/metadata addresses", async () => {
    const resolve = async () => ["169.254.169.254"];
    expect(await code(safeFetch("https://metadata.attacker.example/x", { resolve }))).toBe("blocked_address");
  });
  it("blocks when ANY resolved address is private (rebinding mixes)", async () => {
    const resolve = async () => ["93.184.216.34", "10.0.0.5"];
    expect(await code(safeFetch("https://mixed.example/x", { resolve }))).toBe("blocked_address");
  });
  it("blocks literal private IPs", async () => expect(await code(safeFetch("https://127.0.0.1/x"))).toBe("blocked_address"));
});

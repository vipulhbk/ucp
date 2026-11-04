import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, TestPlatform } from "./env";

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  process.env.UCP_RATE_LIMIT_PER_MIN = "5";
  srv = await startServer();
});
afterAll(async () => {
  delete process.env.UCP_RATE_LIMIT_PER_MIN;
  await srv.close();
});

describe("rate limiting", () => {
  it("returns 429 with Retry-After once the per-minute budget is spent", async () => {
    const p = new TestPlatform(srv.origin);
    const statuses: number[] = [];
    let last;
    for (let i = 0; i < 8; i++) {
      last = await p.call("POST", "/api/ucp/v1/catalog/search", { query: "x" }, {}, { key: false });
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(5).every((s) => s === 429)).toBe(true);
    expect(last!.headers.get("retry-after")).toBe("30");
    expect(last!.body.messages[0].code).toBe("rate_limited");
  });
});

import { describe, expect, it } from "vitest";
import { parseUcpAgent, serializeUcpAgent } from "@/ucp/ucp-agent";

describe("UCP-Agent header (RFC 8941 dictionary)", () => {
  it("parses the spec example", () => {
    expect(parseUcpAgent('profile="https://agent.example/profiles/shopping-agent.json"')).toEqual({ ok: true, profile: "https://agent.example/profiles/shopping-agent.json" });
  });
  it("round-trips", () => {
    const url = "https://platform.example/profile";
    expect(parseUcpAgent(serializeUcpAgent(url))).toEqual({ ok: true, profile: url });
  });
  it("ignores unknown dictionary members", () => {
    expect(parseUcpAgent('profile="https://a.example/p", x=1')).toMatchObject({ ok: true });
  });
  it("rejects missing, malformed, and non-string profile", () => {
    expect(parseUcpAgent(null).ok).toBe(false);
    expect(parseUcpAgent("profile=https://unquoted.example").ok).toBe(false);
    expect(parseUcpAgent("profile=42").ok).toBe(false);
    expect(parseUcpAgent('other="x"').ok).toBe(false);
  });
});

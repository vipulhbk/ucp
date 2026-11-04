import { describe, expect, it } from "vitest";
import { REDACTED, redactBody, redactHeaders } from "@/observability/redact";

describe("redaction", () => {
  it("redacts credentials headers but keeps public signature material", () => {
    const h = redactHeaders({ Authorization: "Bearer abc", "X-API-Key": "k", Cookie: "s=1", Signature: "sig1=:abc:", "UCP-Agent": 'profile="https://a"', "Content-Digest": "sha-256=:x:" });
    expect(h.Authorization).toBe(REDACTED);
    expect(h["X-API-Key"]).toBe(REDACTED);
    expect(h.Cookie).toBe(REDACTED);
    expect(h.Signature).toBe("sig1=:abc:");
    expect(h["UCP-Agent"]).toContain("profile");
    expect(h["Content-Digest"]).toContain("sha-256");
  });
  it("redacts payment secrets and keeps the credential type", () => {
    const out = redactBody({ payment: { instruments: [{ id: "i1", credential: { type: "token", token: "tok_secret" } }] }, pan: "4242424242424242" }) as any;
    expect(out.payment.instruments[0].credential).toEqual({ type: "token", token: REDACTED });
    expect(out.pan).toBe(REDACTED);
  });
  it("masks PII", () => {
    const out = redactBody({ buyer: { email: "jane@example.com", phone_number: "+919876543210", first_name: "Jane" } }) as any;
    expect(out.buyer.email).toBe("j***@example.com");
    expect(out.buyer.phone_number.endsWith("3210")).toBe(true);
    expect(out.buyer.phone_number).not.toContain("98765");
    expect(out.buyer.first_name).not.toBe("Jane");
  });
  it("can leave PII unmasked when asked", () => {
    expect((redactBody({ email: "a@b.co" }, { maskPii: false }) as any).email).toBe("a@b.co");
  });
});

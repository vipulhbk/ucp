import { describe, expect, it } from "vitest";
import { checkAuthorityBinding, isValidReverseDomainName } from "@/ucp/authority-binding";

// Test vectors: the derivation table in overview/index.md → Authority Binding.
const SPEC_TABLE: [string, string, "valid" | "invalid", string][] = [
  ["dev.ucp.shopping.checkout", "https://ucp.dev/schemas/x.json", "valid", "prefix"],
  ["dev.ucp.shopping.checkout", "https://shopping.ucp.dev/x.json", "valid", "prefix"],
  ["com.example.payments.installments", "https://example.com/x.json", "valid", "prefix"],
  ["com.example.pay", "https://pay.example.com/x.json", "valid", "exact"],
  ["com.example.pay", "https://example.com/x.json", "valid", "prefix"],
  ["com.example.pay", "https://evil.example/x.json", "invalid", "mismatch"],
  ["dev.ucp.shopping.checkout", "https://evil.example/x.json", "invalid", "mismatch"],
  ["com.examplecorp.pay", "https://example.com/x.json", "invalid", "mismatch"],
  ["com.example.pay", "https://cdn.example.com/x.json", "invalid", "mismatch"],
];

describe("authority binding — spec derivation table", () => {
  it.each(SPEC_TABLE)("%s ← %s → %s", (name, url, status, rule) => {
    const r = checkAuthorityBinding(name, url);
    expect(r.status).toBe(status);
    expect(r.rule).toBe(rule);
  });
});

describe("authority binding — hardening beyond the table", () => {
  it("rejects userinfo tricks (host is evil.example, not ucp.dev)", () => {
    const r = checkAuthorityBinding("dev.ucp.shopping.checkout", "https://ucp.dev@evil.example/x.json");
    expect(r.status).toBe("invalid");
    expect(r.rule).toBe("userinfo");
  });
  it("rejects non-https", () => expect(checkAuthorityBinding("dev.ucp.x.y", "http://ucp.dev/x.json").rule).toBe("not_https"));
  it("rejects IP literals (incl. decimal-encoded IPv4)", () => {
    expect(checkAuthorityBinding("dev.ucp.x.y", "https://203.0.113.10/x.json").rule).toBe("ip_literal");
    expect(checkAuthorityBinding("dev.ucp.x.y", "https://3405803786/x.json").rule).toBe("ip_literal");
    expect(checkAuthorityBinding("dev.ucp.x.y", "https://[::1]/x.json").rule).toBe("ip_literal");
  });
  it("rejects single-label hosts", () => expect(checkAuthorityBinding("localhost.x.y", "https://localhost/x.json").rule).toBe("single_label"));
  it("normalizes case and trailing dot", () => {
    expect(checkAuthorityBinding("dev.ucp.shopping.checkout", "https://UCP.DEV./x.json").status).toBe("valid");
  });
  it("normalizes IDN to punycode before reversing", () => {
    const r = checkAuthorityBinding("com.xn--bcher-kva.pay", "https://bücher.com/x.json");
    expect(r.status).toBe("valid");
  });
  it("is label-aligned: a name that merely starts with the prefix text does not bind", () => {
    expect(checkAuthorityBinding("com.exampleX.pay", "https://example.com/x.json").status).toBe("invalid");
  });
  it("warns, but still validates, for public-suffix hosts", () => {
    const r = checkAuthorityBinding("app.vercel.demo.mock_tokenizer", "https://demo.vercel.app/schemas/m.json");
    expect(r.status).toBe("valid");
    expect(r.warning).toMatch(/public suffix/);
  });
  it("demo relaxation is explicit, never silent", () => {
    const strict = checkAuthorityBinding("localhost.mock_tokenizer", "http://localhost:3000/s.json");
    expect(strict.status).toBe("invalid");
    const relaxed = checkAuthorityBinding("localhost.mock_tokenizer", "http://localhost:3000/s.json", { relaxedHosts: ["localhost"] });
    expect(relaxed.status).toBe("relaxed");
    expect(relaxed.reason).toMatch(/DEMO RELAXATION/);
  });
});

describe("reverse-domain naming convention", () => {
  it("accepts {reverse-domain}.{service}.{capability}", () => {
    expect(isValidReverseDomainName("dev.ucp.shopping.checkout")).toBe(true);
    expect(isValidReverseDomainName("com.example.payments.installments")).toBe(true);
    expect(isValidReverseDomainName("dev.ucp.common.identity_linking")).toBe(true);
  });
  it("rejects too few labels and bad characters", () => {
    expect(isValidReverseDomainName("checkout")).toBe(false);
    expect(isValidReverseDomainName("dev.ucp")).toBe(false);
    expect(isValidReverseDomainName("Dev.UCP.shopping.checkout")).toBe(false);
  });
});

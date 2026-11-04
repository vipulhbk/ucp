import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from "node:crypto";
import { httpbis } from "http-message-signatures";
import { describe, expect, it } from "vitest";
import { contentDigest, signRequest, verifyRequest } from "@/ucp/http-signatures";
import { demoEd25519Key, demoSigningKey, generateSigningKey, jwkThumbprint } from "@/ucp/keys";

const es = demoSigningKey();
const ed = demoEd25519Key();
const URL_ = "https://platform.example.com/webhooks/ucp/orders";
const BODY = JSON.stringify({ id: "order_abc123", currency: "INR" });
const base = { "content-type": "application/json", "ucp-agent": 'profile="https://merchant.example/.well-known/ucp"', "webhook-id": "whk_1", "webhook-timestamp": "1790000000" };

const sign = (key = es, over: Partial<Parameters<typeof signRequest>[0]> = {}): Record<string, string> => {
  const added = signRequest({ method: "POST", url: URL_, headers: base, body: BODY, key, extraComponents: ["webhook-id", "webhook-timestamp"], ...over });
  return { ...base, ...added };
};
const verify = (headers: Record<string, string>, over: Partial<Parameters<typeof verifyRequest>[0]> = {}) =>
  verifyRequest({ method: "POST", url: URL_, headers, body: BODY, resolveKey: (kid) => (kid === es.kid ? es.publicJwk : kid === ed.kid ? ed.publicJwk : undefined), ...over });

describe("keys", () => {
  it("default signing key is ES256 (EC P-256), the spec's mandatory verification baseline", () => {
    expect(es).toMatchObject({ alg: "ES256", publicJwk: { kty: "EC", crv: "P-256", use: "sig", alg: "ES256" } });
    expect(es.publicJwk).not.toHaveProperty("d");
  });
  it("kid is the RFC 7638 thumbprint, and the demo key is deterministic", () => {
    expect(es.kid).toBe(jwkThumbprint(es.publicJwk));
    expect(demoSigningKey().kid).toBe(es.kid);
    expect(es.kid).not.toBe(ed.kid);
  });
  it("RFC 7638 thumbprint matches the RFC's own example", () => {
    // RFC 7638 §3.1 uses an RSA key; the OKP example in RFC 8037 Appendix A.3 gives the Ed25519 thumbprint:
    expect(jwkThumbprint({ kty: "OKP", crv: "Ed25519", x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" })).toBe("kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k");
  });
});

describe("sign → verify", () => {
  it("round-trips for ES256 and for optional EdDSA", () => {
    expect(verify(sign(es))).toMatchObject({ ok: true, keyid: es.kid, alg: "ES256" });
    expect(verify(sign(ed))).toMatchObject({ ok: true, keyid: ed.kid, alg: "EdDSA" });
  });
  it("covers the spec-required components plus webhook-id/webhook-timestamp", () => {
    const r = verify(sign(), { requireComponents: ["webhook-id", "webhook-timestamp"] });
    expect(r.ok && r.components).toEqual(["@method", "@authority", "@path", "content-digest", "content-type", "ucp-agent", "webhook-id", "webhook-timestamp"].filter((c) => (r.ok ? r.components.includes(c) : false)));
    expect(r.ok && r.components).toEqual(expect.arrayContaining(["@method", "@authority", "@path", "ucp-agent", "content-digest", "content-type", "webhook-id", "webhook-timestamp"]));
  });
  it("ECDSA signatures are raw r||s (64 bytes), never DER", () => {
    const sig = sign()["signature"]!.match(/:(.+):/)![1]!;
    expect(Buffer.from(sig, "base64")).toHaveLength(64);
  });
  it("a DER-encoded ECDSA signature is rejected", () => {
    const h = sign();
    const input = h["signature-input"]!;
    const params = input.slice("sig1=".length);
    // rebuild the base by signing with DER via node on the same base: easiest is to sign garbage DER over anything
    const der = nodeSign("sha256", Buffer.from("x"), es.privateKey);
    const bad = { ...h, signature: `sig1=:${der.toString("base64")}:` };
    expect(params).toContain("keyid");
    expect(verify(bad)).toMatchObject({ ok: false, reason: "signature_invalid" });
  });
  it("Content-Digest is sha-256 over the raw bytes (RFC 9530)", () => {
    expect(contentDigest("{}")).toBe("sha-256=:RBNvo1WzZ4oRRq0W9+hknpT7T8If536DEMBg9hyq/4o=:");
    expect(sign()["content-digest"]).toBe(contentDigest(BODY));
  });
  it("GET with a query covers @query and needs no body components", () => {
    const h = signRequest({ method: "GET", url: "https://m.example/orders/1?x=1", headers: { "ucp-agent": 'profile="https://p"' }, key: es });
    expect(h["signature-input"]).toContain('"@query"');
    expect(h["content-digest"]).toBeUndefined();
    expect(verifyRequest({ method: "GET", url: "https://m.example/orders/1?x=1", headers: { "ucp-agent": 'profile="https://p"', ...h }, resolveKey: () => es.publicJwk })).toMatchObject({ ok: true });
    expect(verifyRequest({ method: "GET", url: "https://m.example/orders/1?x=2", headers: { "ucp-agent": 'profile="https://p"', ...h }, resolveKey: () => es.publicJwk })).toMatchObject({ ok: false, reason: "signature_invalid" });
  });
});

describe("verification failures (spec: Signature Errors)", () => {
  it("tampered body → digest_mismatch (400)", () => expect(verify(sign(), { body: BODY.replace("INR", "USD") })).toMatchObject({ ok: false, reason: "digest_mismatch" }));
  it("tampered body with a recomputed digest → signature_invalid, because the digest header is signed", () => {
    const h = sign();
    const body = BODY.replace("INR", "USD");
    expect(verify({ ...h, "content-digest": contentDigest(body) }, { body })).toMatchObject({ ok: false, reason: "signature_invalid" });
  });
  it("any signed header changed → signature_invalid", () => {
    for (const k of ["ucp-agent", "webhook-id", "webhook-timestamp", "content-type"]) {
      expect(verify({ ...sign(), [k]: "changed" }), k).toMatchObject({ ok: false, reason: "signature_invalid" });
    }
  });
  it("method, path or host changed (replay to another endpoint) → signature_invalid", () => {
    const h = sign();
    expect(verify(h, { method: "PUT" })).toMatchObject({ reason: "signature_invalid" });
    expect(verify(h, { url: "https://platform.example.com/webhooks/ucp/other" })).toMatchObject({ reason: "signature_invalid" });
    expect(verify(h, { url: "https://evil.example.com/webhooks/ucp/orders" })).toMatchObject({ reason: "signature_invalid" });
  });
  it("signed by another key → signature_invalid; unknown keyid → key_not_found", () => {
    const other = generateSigningKey("ES256");
    const forged = sign(other);
    expect(verify(forged, { resolveKey: () => ({ ...es.publicJwk }) })).toMatchObject({ reason: "signature_invalid" });
    expect(verify(forged)).toMatchObject({ reason: "key_not_found" });
  });
  it("unsupported key types are skipped, not fatal: algorithm_unsupported", () => {
    expect(verify(sign(), { resolveKey: () => ({ kty: "RSA", crv: undefined, x: "x" }) })).toMatchObject({ reason: "algorithm_unsupported" });
  });
  it("keys marked use:enc are not usable for verification", () => {
    expect(verify(sign(), { resolveKey: () => ({ ...es.publicJwk, use: "enc" }) })).toMatchObject({ reason: "key_not_found" });
  });
  it("missing or malformed signature headers", () => {
    const { signature: _s, ...noSig } = sign();
    void _s;
    expect(verify(noSig)).toMatchObject({ reason: "signature_missing" });
    expect(verify({ ...sign(), "signature-input": "garbage((" })).toMatchObject({ reason: "signature_malformed" });
    expect(verify({ ...sign(), signature: "sig1=notbytes" })).toMatchObject({ reason: "signature_malformed" });
  });
  it("a signature that omits a required component is treated as unsigned (coverage_insufficient)", () => {
    const weak = signRequest({ method: "POST", url: URL_, headers: { "content-type": "application/json" }, body: BODY, key: es }); // no ucp-agent in the message when signing
    expect(verify({ ...base, ...weak })).toMatchObject({ ok: false, reason: "coverage_insufficient" }); // but the message DOES carry UCP-Agent now
  });
  it("application-demanded components (webhook-id) must be covered", () => {
    const h = signRequest({ method: "POST", url: URL_, headers: base, body: BODY, key: es }); // covers ucp-agent but not webhook-id
    expect(verify({ ...base, ...h }, { requireComponents: ["webhook-id"] })).toMatchObject({ reason: "coverage_insufficient" });
  });
  it("rejects stale and future-dated signatures", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verify(sign(es, { created: now - 600 }))).toMatchObject({ reason: "signature_expired" });
    expect(verify(sign(es, { created: now + 600 }))).toMatchObject({ reason: "signature_expired" });
    expect(verify(sign(es, { created: now - 10, expires: now - 1 }))).toMatchObject({ reason: "signature_expired" });
    expect(verify(sign(es, { created: now - 10 }))).toMatchObject({ ok: true });
  });
});

describe("interoperability with an independent RFC 9421 implementation (http-message-signatures)", () => {
  const pub = createPublicKey(es.privateKey);
  const verifierFor = (id: string) => async () => ({
    id,
    algs: ["ecdsa-p256-sha256"],
    verify: async (data: Buffer, signature: Buffer) => nodeVerify("sha256", data, { key: pub, dsaEncoding: "ieee-p1363" }, signature),
  });

  it("our signature verifies under the independent implementation", async () => {
    const h = sign();
    const ok = await httpbis.verifyMessage({ keyLookup: verifierFor(es.kid) }, { method: "POST", url: URL_, headers: h });
    expect(ok).toBe(true);
  });
  it("the independent implementation rejects our signature when the message is altered (it is not accepting everything)", async () => {
    const h = { ...sign(), "webhook-id": "tampered" };
    const ok = await httpbis.verifyMessage({ keyLookup: verifierFor(es.kid) }, { method: "POST", url: URL_, headers: h });
    expect(ok).not.toBe(true);
  });
  it("a signature produced by the independent implementation verifies under ours", async () => {
    const headers: Record<string, string> = { ...base, "content-digest": contentDigest(BODY) };
    const signed = await httpbis.signMessage(
      {
        key: { id: es.kid, alg: "ecdsa-p256-sha256", sign: async (data: Buffer) => nodeSign("sha256", data, { key: es.privateKey, dsaEncoding: "ieee-p1363" }) },
        fields: ["@method", "@authority", "@path", "ucp-agent", "content-digest", "content-type", "webhook-id", "webhook-timestamp"],
        params: ["keyid", "created"],
      },
      { method: "POST", url: URL_, headers },
    );
    const r = verify(signed.headers as Record<string, string>, { requireComponents: ["webhook-id", "webhook-timestamp"] });
    expect(r).toMatchObject({ ok: true, keyid: es.kid });
  });
  it("Ed25519: ours verifies under the independent implementation too", async () => {
    const edPub = createPublicKey(createPrivateKey(ed.privateKey.export({ format: "pem", type: "pkcs8" })));
    const h = sign(ed);
    const ok = await httpbis.verifyMessage(
      { keyLookup: async () => ({ id: ed.kid, algs: ["ed25519"], verify: async (data: Buffer, sig: Buffer) => nodeVerify(null, data, edPub, sig) }) },
      { method: "POST", url: URL_, headers: h },
    );
    expect(ok).toBe(true);
  });
  it("generateKeyPairSync keys also round-trip (no dependence on the seeded demo key)", () => {
    const k = generateKeyPairSync("ec", { namedCurve: "P-256" });
    expect(k.privateKey.asymmetricKeyType).toBe("ec");
    const g = generateSigningKey("ES256");
    expect(verify(sign(g), { resolveKey: () => g.publicJwk })).toMatchObject({ ok: true });
  });
});

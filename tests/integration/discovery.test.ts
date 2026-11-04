import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as wellKnown } from "@/app/.well-known/ucp/route";
import { GET as platformProfile } from "@/app/api/platform/profile/route";
import { MemoryStore } from "@/persistence/memory";
import { Recorder } from "@/observability/recorder";
import { discoverMerchant } from "@/platform/discovery";
import { buildBusinessProfile, buildPlatformProfile } from "@/ucp/profile";
import { demoSigningKey } from "@/ucp/keys";
import { ProfileBusinessSchema, ProfilePlatformSchema } from "@/ucp/schemas";
import { UCP_VERSION, CAP } from "@/ucp/constants";
import { serve } from "./helpers";


let srv: Awaited<ReturnType<typeof serve>>;

beforeAll(async () => {
  srv = await serve({
    "/.well-known/ucp": wellKnown,
    "/api/platform/profile": platformProfile,
  });
});
afterAll(() => srv.close());

describe("GET /.well-known/ucp", () => {
  it("returns a profile that passes the official schema and pins the version", async () => {
    const res = await fetch(`${srv.origin}/.well-known/ucp`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(ProfileBusinessSchema.safeParse(body).success, JSON.stringify(ProfileBusinessSchema.safeParse(body))).toBe(true);
    expect(body.ucp.version).toBe(UCP_VERSION);
    expect(body.ucp.services["dev.ucp.shopping"][0]).toMatchObject({ transport: "rest", endpoint: `${srv.origin}/api/ucp/v1` });
  });
  it("advertises the planned v1 capability set with correct extends", async () => {
    const body = await (await fetch(`${srv.origin}/.well-known/ucp`)).json();
    expect(Object.keys(body.ucp.capabilities).sort()).toEqual([CAP.catalogLookup, CAP.catalogSearch, CAP.checkout, CAP.discount, CAP.fulfillment, CAP.order].sort());
    expect(body.ucp.capabilities[CAP.fulfillment][0].extends).toBe(CAP.checkout);
    expect(body.ucp.capabilities[CAP.checkout][0].schema).toBe(`https://ucp.dev/${UCP_VERSION}/schemas/shopping/checkout.json`);
  });
  it("publishes the signing key as a JWK with an RFC 7638 kid", async () => {
    const body = await (await fetch(`${srv.origin}/.well-known/ucp`)).json();
    expect(body.keys[0]).toMatchObject({ kty: "EC", crv: "P-256", use: "sig", alg: "ES256", kid: demoSigningKey().kid }); // ES256 = the spec's universal verification baseline
    expect(body.keys[0].d).toBeUndefined(); // never the private part
  });
  it("advertises the simulated payment handler, clearly labelled", async () => {
    const body = await (await fetch(`${srv.origin}/.well-known/ucp`)).json();
    const [name, entries] = Object.entries(body.ucp.payment_handlers)[0] as [string, any[]];
    expect(name).toMatch(/\.mock_tokenizer$/);
    expect(entries[0].config.simulated).toBe(true);
  });
});

describe("platform profile", () => {
  it("passes the official platform schema and advertises the webhook URL", async () => {
    const body = await (await fetch(`${srv.origin}/api/platform/profile`)).json();
    expect(ProfilePlatformSchema.safeParse(body).success, JSON.stringify(ProfilePlatformSchema.safeParse(body))).toBe(true);
    expect(body.ucp.capabilities[CAP.order][0].config.webhook_url).toMatch(/\/api\/platform\/webhooks\/orders\/anonymous$/);
    const scoped = await (await fetch(`${srv.origin}/api/platform/profile?p=${"a".repeat(24)}`)).json();
    expect(scoped.ucp.capabilities[CAP.order][0].config.webhook_url).toMatch(new RegExp(`/api/platform/webhooks/orders/${"a".repeat(24)}$`));
    const hostile = await (await fetch(`${srv.origin}/api/platform/profile?p=../../x`)).json(); // not a platform id: ignored
    expect(hostile.ucp.capabilities[CAP.order][0].config.webhook_url).toMatch(/\/anonymous$/);
  });
});

describe("platform-side discovery over real HTTP", () => {
  const platform = () => buildPlatformProfile({ origin: srv.origin, webhookUrl: `${srv.origin}/api/platform/webhooks/orders` });
  const base = () => ({
    origin: srv.origin,
    platformProfile: platform(),
    platformProfileUrl: `${srv.origin}/api/platform/profile`,
    fetchOptions: { allowedOrigins: [srv.origin], devLoopbackHosts: ["localhost"] },
    bindingOptions: { relaxedHosts: ["localhost"] },
  });

  it("derives the REST endpoint from the profile and negotiates all shared capabilities", async () => {
    const store = new MemoryStore();
    const r = await discoverMerchant({ ...base(), recorder: new Recorder(store), sid: "s1" });
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.rest?.endpoint).toBe(`${srv.origin}/api/ucp/v1`);
    expect(Object.keys(r.negotiation!.active).sort()).toEqual([CAP.catalogLookup, CAP.catalogSearch, CAP.checkout, CAP.discount, CAP.fulfillment, CAP.order].sort());
    expect(r.profileValidation?.ok).toBe(true);
    expect(r.versionSelection).toEqual({ kind: "current", version: UCP_VERSION });
  });
  it("records the real request in the inspector log (redacted)", async () => {
    const store = new MemoryStore();
    await discoverMerchant({ ...base(), recorder: new Recorder(store), sid: "s2" });
    const log = await new Recorder(store).list("s2");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor: "platform", op: "get_profile", method: "GET", status: 200 });
    expect(log[0]!.requestHeaders["ucp-agent"]).toContain("profile=");
    expect(log[0]!.url).toBe(`${srv.origin}/.well-known/ucp`);
  });
  it("marks the demo handler binding as relaxed on localhost (explicit deviation)", async () => {
    const r = await discoverMerchant(base());
    const h = r.bindings.find((b) => b.entity === "payment_handler")!;
    expect(h.result.status).toBe("relaxed");
    expect(r.paymentHandlers[0]).toMatchObject({ simulated: true, instruments: ["card"] });
  });
  it("capabilities bind to ucp.dev by the spec algorithm", async () => {
    const r = await discoverMerchant(base());
    const caps = r.bindings.filter((b) => b.entity === "capability");
    expect(caps.length).toBe(6);
    expect(caps.every((b) => b.result.status === "valid")).toBe(true);
  });
  it("refuses an origin that is not allowlisted (no arbitrary URL fetching)", async () => {
    const r = await discoverMerchant({ ...base(), origin: "http://localhost:9", fetchOptions: { allowedOrigins: [srv.origin], devLoopbackHosts: ["localhost"] } });
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe("not_allowlisted");
  });
  it("reports capability mismatch when the platform lacks a capability", async () => {
    const p = buildPlatformProfile({ origin: srv.origin, webhookUrl: "x", capabilities: [CAP.checkout, CAP.order] });
    const r = await discoverMerchant({ ...base(), platformProfile: p });
    expect(Object.keys(r.negotiation!.active).sort()).toEqual([CAP.checkout, CAP.order].sort());
    expect(r.negotiation!.excluded.map((x) => x.name)).toContain(CAP.discount);
  });
  it("reports version incompatibility", async () => {
    const r = await discoverMerchant({ ...base(), platformSupportedVersions: ["2026-01-11"] });
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe("version_unsupported");
  });
  it("rejects capabilities whose schema URL fails authority binding", async () => {
    const evil = buildBusinessProfile({ origin: srv.origin, keys: [demoSigningKey().publicJwk] });
    evil.ucp.capabilities![CAP.discount]![0]!.schema = "https://evil.example/discount.json";
    const s2 = await serve({ "/.well-known/ucp": () => Response.json(evil) });
    try {
      const r = await discoverMerchant({ ...base(), origin: s2.origin, fetchOptions: { allowedOrigins: [s2.origin], devLoopbackHosts: ["localhost"] } });
      expect(r.rejectedEntities).toContain(CAP.discount);
      expect(r.negotiation!.active[CAP.discount]).toBeUndefined();
      expect(r.negotiation!.active[CAP.checkout]).toBeDefined();
    } finally {
      await s2.close();
    }
  });
  it("reports malformed profiles with validation paths", async () => {
    const s3 = await serve({ "/.well-known/ucp": () => Response.json({ ucp: { version: "nope", services: [], capabilities: [] } }) });
    try {
      const r = await discoverMerchant({ ...base(), origin: s3.origin, fetchOptions: { allowedOrigins: [s3.origin], devLoopbackHosts: ["localhost"] } });
      expect(r.error?.kind).toBe("profile_malformed");
      expect(r.profileValidation?.issues.some((i) => i.path.startsWith("$.ucp"))).toBe(true);
    } finally {
      await s3.close();
    }
  });
  it("follows supported_versions to a leaf profile and checks its version", async () => {
    const legacyVersion = "2026-04-08";
    const leaf = buildBusinessProfile({ origin: "http://localhost", keys: [] });
    leaf.ucp.version = legacyVersion;
    const biz = buildBusinessProfile({ origin: "http://localhost", keys: [] });
    const holder: { origin?: string } = {};
    const s4 = await serve({
      "/.well-known/ucp": () => Response.json({ ...biz, ucp: { ...biz.ucp, supported_versions: { [legacyVersion]: `${holder.origin}/.well-known/ucp/${legacyVersion}` } } }),
      [`/.well-known/ucp/${legacyVersion}`]: () => Response.json(leaf),
    });
    holder.origin = s4.origin;
    try {
      const r = await discoverMerchant({ ...base(), origin: s4.origin, platformSupportedVersions: [legacyVersion], fetchOptions: { allowedOrigins: [s4.origin], devLoopbackHosts: ["localhost"] } });
      expect(r.versionSelection).toMatchObject({ kind: "legacy", version: legacyVersion });
      expect(r.profile?.ucp.version).toBe(legacyVersion);
    } finally {
      await s4.close();
    }
  });
});

import { describe, expect, it } from "vitest";
import { businessSupportsVersion, intersectCapabilities, relevantCapabilities, selectProtocolVersion } from "@/ucp/negotiation";

const e = (version: string, extra: object = {}) => ({ version, ...extra });
const CHK = "dev.ucp.shopping.checkout";

describe("intersection algorithm (overview → Intersection Algorithm)", () => {
  it("includes only capabilities both sides advertise", () => {
    const r = intersectCapabilities({ [CHK]: [e("2026-08-25")], "dev.ucp.shopping.order": [e("2026-08-25")] }, { [CHK]: [e("2026-08-25")] });
    expect(Object.keys(r.active)).toEqual([CHK]);
    expect(r.excluded).toContainEqual(expect.objectContaining({ name: "dev.ucp.shopping.order", reason: "not_advertised_by_platform" }));
  });
  it("selects the highest version present in BOTH arrays (exact equality, not date order)", () => {
    const r = intersectCapabilities({ "com.acme.x.y": [e("2026-01-01"), e("2026-06-15")] }, { "com.acme.x.y": [e("2026-06-15"), e("2026-09-09")] });
    expect(r.active["com.acme.x.y"]?.version).toBe("2026-06-15");
  });
  it("excludes a capability with no mutual version", () => {
    const r = intersectCapabilities({ [CHK]: [e("2026-08-25")] }, { [CHK]: [e("2026-04-08")] });
    expect(r.active).toEqual({});
    expect(r.excluded[0]?.reason).toBe("no_mutual_version");
  });
  it("prunes an extension whose parent is not active", () => {
    const r = intersectCapabilities(
      { [CHK]: [e("2026-08-25")], "dev.ucp.shopping.discount": [e("2026-08-25", { extends: CHK })] },
      { [CHK]: [e("2026-04-08")], "dev.ucp.shopping.discount": [e("2026-08-25", { extends: CHK })] },
    );
    expect(r.active).toEqual({});
    expect(r.excluded.map((x) => x.reason).sort()).toEqual(["no_mutual_version", "orphaned_extension"]);
  });
  it("keeps a multi-parent extension when at least one parent is active", () => {
    const disc = e("2026-08-25", { extends: [CHK, "dev.ucp.shopping.cart"] });
    const r = intersectCapabilities({ [CHK]: [e("2026-08-25")], "dev.ucp.shopping.discount": [disc] }, { [CHK]: [e("2026-08-25")], "dev.ucp.shopping.discount": [disc] });
    expect(Object.keys(r.active).sort()).toEqual([CHK, "dev.ucp.shopping.discount"]);
  });
  it("prunes transitive chains until a fixpoint", () => {
    const r = intersectCapabilities(
      { "a.b.c.root": [e("2026-08-25")], "a.b.c.mid": [e("2026-08-25", { extends: "a.b.c.root" })], "a.b.c.leaf": [e("2026-08-25", { extends: "a.b.c.mid" })] },
      { "a.b.c.mid": [e("2026-08-25")], "a.b.c.leaf": [e("2026-08-25")] },
    );
    expect(r.active).toEqual({});
    expect(r.excluded.filter((x) => x.reason === "orphaned_extension").map((x) => x.name).sort()).toEqual(["a.b.c.leaf", "a.b.c.mid"]);
  });
  it("records a human-readable trace", () => {
    const r = intersectCapabilities({ [CHK]: [e("2026-08-25")] }, { [CHK]: [e("2026-08-25")] });
    expect(r.trace[0]?.detail).toContain("mutual version 2026-08-25");
  });
});

describe("protocol version selection (overview → Versioning)", () => {
  it("uses the current profile when versions match", () => {
    expect(selectProtocolVersion({ version: "2026-08-25" }, ["2026-08-25"])).toEqual({ kind: "current", version: "2026-08-25" });
  });
  it("prefers the most recent mutual version and follows supported_versions for older ones", () => {
    const s = selectProtocolVersion({ version: "2026-08-25", supported_versions: { "2026-04-08": "https://b.example/.well-known/ucp/2026-04-08" } }, ["2026-04-08"]);
    expect(s).toEqual({ kind: "legacy", version: "2026-04-08", profileUri: "https://b.example/.well-known/ucp/2026-04-08" });
  });
  it("reports unsupported when there is no overlap", () => {
    expect(selectProtocolVersion({ version: "2026-08-25" }, ["2026-01-11"]).kind).toBe("unsupported");
  });
  it("business side: platform version must equal version or be a supported_versions key", () => {
    const biz = { version: "2026-08-25", supported_versions: { "2026-04-08": "https://x" } };
    expect(businessSupportsVersion(biz, "2026-08-25")).toBe(true);
    expect(businessSupportsVersion(biz, "2026-04-08")).toBe(true);
    expect(businessSupportsVersion(biz, "2026-01-11")).toBe(false);
    expect(businessSupportsVersion({ version: "2026-08-25" }, "constructor")).toBe(false);
  });
});

describe("response capability selection", () => {
  const active = { [CHK]: e("2026-08-25"), "dev.ucp.shopping.fulfillment": e("2026-08-25", { extends: CHK }), "dev.ucp.shopping.order": e("2026-08-25") };
  it("checkout responses include checkout + its extensions, not order", () => {
    expect(Object.keys(relevantCapabilities("checkout", active)).sort()).toEqual([CHK, "dev.ucp.shopping.fulfillment"]);
  });
  it("order responses include only order", () => {
    expect(Object.keys(relevantCapabilities("order", active))).toEqual(["dev.ucp.shopping.order"]);
  });
});

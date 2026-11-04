import { describe, expect, it } from "vitest";
import { examplesFor } from "@/app-services/validator/examples";
import { checkoutRules, errorRules, orderRules } from "@/app-services/validator/rules";
import { TARGETS, targetForOp } from "@/app-services/validator/targets";
import { MAX_PAYLOAD_BYTES, SCOPE_NOTE, validateText } from "@/app-services/validator/validate";

const v = (target: string, payload: unknown) => validateText(target, typeof payload === "string" ? payload : JSON.stringify(payload))!;
const issue = (r: ReturnType<typeof v>, path: string) => r.schema!.issues.find((i) => i.path === path);

describe("every validation target ships honest examples", () => {
  it.each(TARGETS.map((t) => [t.id]))("%s: the valid example passes the schema", (id) => {
    const ex = examplesFor(id)!;
    const r = v(id, ex.valid.payload);
    expect(r.schema!.issues, JSON.stringify(r.schema!.issues)).toEqual([]);
    expect(r.schema!.ok).toBe(true);
    expect(r.rules.filter((x) => x.level === "spec" && !x.ok), "spec rules on the valid example").toEqual([]);
  });
  it.each(TARGETS.flatMap((t) => (examplesFor(t.id)?.invalid ?? []).map((e) => [t.id, e.title] as const)))("%s: invalid example “%s” is caught by the layer it claims", (id, title) => {
    const e = examplesFor(id)!.invalid.find((x) => x.title === title)!;
    const r = v(id, e.payload);
    expect(e.why, "every invalid example explains itself").toBeTruthy();
    if (e.breaks === "rule") {
      expect(r.schema!.ok, "schema-valid on purpose").toBe(true);
      expect(r.rules.some((x) => !x.ok), "a rule check must fail").toBe(true);
    } else {
      expect(r.schema!.ok).toBe(false);
      expect(r.schema!.issues.length).toBeGreaterThan(0);
    }
  });
  it("every target has an official source document, a generated schema name, and a URL at the pinned release", () => {
    for (const t of TARGETS) {
      expect(t.doc && typeof t.doc === "object", t.id).toBe(true);
      expect(t.docUrl).toMatch(/^https:\/\/ucp\.dev\/2026-08-25\/schemas\//);
      expect(t.zodName).toMatch(/Schema$/);
    }
  });
  it("covers the ten message types the brief names", () => expect(TARGETS.map((t) => t.id).sort()).toEqual(["business_profile", "catalog_search_request", "catalog_search_response", "checkout_complete_request", "checkout_create_request", "checkout_response", "checkout_update_request", "error_response", "order", "platform_profile"]));
});

describe("error paths and messages are understandable", () => {
  it("reports JSON paths, expected vs received, and the actual value", () => {
    const r = v("checkout_response", examplesFor("checkout_response")!.invalid[0]!.payload);
    expect(issue(r, "$.status")).toMatchObject({ code: "invalid_enum_value", received: "pending", actual: '"pending"' });
    expect(issue(r, "$.status")!.expected).toContain("ready_for_complete");
  });
  it("points at the exact element: quantity 0 in line item 0", () => {
    const r = v("checkout_create_request", { line_items: [{ item: { id: "x" }, quantity: 0 }] });
    expect(issue(r, "$.line_items[0].quantity")).toMatchObject({ code: "too_small", expected: "at least 1", actual: "0" });
  });
  it("missing members are reported as absent", () => {
    const r = v("checkout_create_request", {});
    expect(issue(r, "$.line_items")).toMatchObject({ actual: "(absent)", expected: "array", received: "undefined" });
  });
  it("wrong types say what was expected", () => {
    const r = v("checkout_create_request", { line_items: [{ item: { id: 42 }, quantity: 1 }] });
    expect(issue(r, "$.line_items[0].item.id")).toMatchObject({ expected: "string", received: "number", actual: "42" });
  });
  it("totals cardinality (min/max contains) is explained", () => {
    const r = v("checkout_response", examplesFor("checkout_response")!.invalid[1]!.payload);
    expect(r.schema!.issues.some((i) => /subtotal/.test(i.message))).toBe(true);
  });
  it("union failures surface the closest branch instead of an opaque 'Invalid input'", () => {
    const r = v("checkout_update_request", examplesFor("checkout_update_request")!.invalid[1]!.payload);
    expect(r.schema!.issues.length).toBeGreaterThan(0);
    expect(r.schema!.issues.some((i) => i.path.includes("methods[0]"))).toBe(true);
    expect(r.schema!.issues.every((i) => i.message !== "Invalid input")).toBe(true);
  });
  it("closed envelopes reject unknown members", () => {
    const r = v("error_response", { ...(examplesFor("error_response")!.valid.payload as object), extra: true });
    expect(r.schema!.issues[0]).toMatchObject({ code: "unrecognized_keys", message: "Unrecognized key(s): extra" });
  });
  it("open objects accept extra members (the spec's extensibility), so they are NOT flagged", () => {
    const r = v("checkout_create_request", { line_items: [{ item: { id: "x" }, quantity: 1 }], "com.vendor.extra": { anything: true } });
    expect(r.schema!.ok).toBe(true);
  });
  it("older profile shapes are called out by path", () => {
    const r = v("business_profile", examplesFor("business_profile")!.invalid[1]!.payload);
    expect(issue(r, "$.ucp.capabilities")).toMatchObject({ expected: "object", received: "array" });
  });
  it("syntax errors are reported as parse failures, not schema failures", () => {
    const r = v("checkout_response", "{ not json");
    expect(r.parse.ok).toBe(false);
    expect(r.schema).toBeUndefined();
    expect((r.parse as { message: string }).message.length).toBeGreaterThan(5);
  });
  it("non-object JSON is reported, never crashes", () => {
    for (const p of ["null", "42", '"str"', "[]"]) expect(v("order", p).schema!.ok, p).toBe(false);
  });
  it("oversized payloads are refused", () => {
    const r = v("order", " ".repeat(MAX_PAYLOAD_BYTES + 1));
    expect(r.parse).toMatchObject({ ok: false, message: expect.stringContaining("exceeds") });
  });
  it("unknown targets return null", () => expect(validateText("nope", "{}")).toBeNull());
  it("caps the number of reported issues", () => {
    const r = v("checkout_create_request", { line_items: Array.from({ length: 200 }, () => ({ item: { id: 1 }, quantity: 0 })) });
    expect(r.schema!.issues.length).toBeLessThanOrEqual(50);
  });
});

describe("schema validation is clearly separated from conformance and from rule checks", () => {
  it("every report carries the scope statement: not protocol conformance", () => {
    for (const t of TARGETS) expect(v(t.id, {}).scope).toBe(SCOPE_NOTE);
    expect(SCOPE_NOTE).toMatch(/does NOT test protocol behavior/);
    expect(SCOPE_NOTE).toMatch(/conformance suite/);
    expect(SCOPE_NOTE).toMatch(/has not been run/);
  });
  it("a schema-valid payload can still fail spec rules, and the report shows both layers", () => {
    const bad = examplesFor("checkout_response")!.invalid[3]!.payload;
    const r = v("checkout_response", bad);
    expect(r.schema!.ok).toBe(true);
    expect(r.rules.find((x) => x.id === "completed-has-order")).toMatchObject({ ok: false, level: "spec", source: expect.stringContaining("checkout/index.md") });
  });
  it("rule checks still run when the schema fails (for a payload that is an object)", () => {
    const r = v("checkout_response", { status: "completed", ucp: {}, totals: [] });
    expect(r.schema!.ok).toBe(false);
    expect(r.rules.length).toBeGreaterThan(0);
  });
  it("heuristics are labelled as such and do not claim to be spec rules", () => {
    const valid = examplesFor("checkout_response")!.valid.payload as { totals: { type: string; amount: number }[] };
    const broken = { ...valid, totals: valid.totals.map((t) => (t.type === "total" ? { ...t, amount: t.amount + 1 } : t)) };
    const r = v("checkout_response", broken);
    expect(r.schema!.ok).toBe(true);
    expect(r.rules.find((x) => x.id === "totals-add-up")).toMatchObject({ ok: false, level: "heuristic", source: expect.stringContaining("Not stated by the spec") });
  });
});

describe("spec rule checks", () => {
  const base = examplesFor("checkout_response")!.valid.payload as Record<string, unknown>;
  const rule = (rs: ReturnType<typeof checkoutRules>, id: string) => rs.find((r) => r.id === id)!;
  it("requires_escalation needs a continue_url", () => {
    const { continue_url: _c, ...noUrl } = base as { continue_url?: string };
    void _c;
    expect(rule(checkoutRules({ ...noUrl, status: "requires_escalation" }), "escalation-has-continue-url").ok).toBe(false);
    expect(rule(checkoutRules({ ...base, status: "requires_escalation" }), "escalation-has-continue-url").ok).toBe(true);
  });
  it("complete_in_progress must not contain an order", () => {
    expect(rule(checkoutRules({ ...base, status: "complete_in_progress", order: { id: "o", permalink_url: "https://x.example" } }), "order-only-when-completed").ok).toBe(false);
    expect(rule(checkoutRules({ ...base, status: "complete_in_progress" }), "order-only-when-completed").ok).toBe(true);
  });
  it("ready_for_complete with an open recoverable error is flagged (heuristic)", () => {
    const r = checkoutRules({ ...base, status: "ready_for_complete", messages: [{ type: "error", code: "missing", severity: "recoverable", path: "$.buyer.email", content: "x" }] });
    expect(rule(r, "ready-without-open-errors")).toMatchObject({ ok: false, level: "heuristic" });
  });
  it("the version rule is informational", () => expect(rule(checkoutRules({ ...base, ucp: { ...(base.ucp as object), version: "2026-01-11" } }), "pinned-version")).toMatchObject({ ok: false, level: "info" }));
  it("order status derivation follows the spec formula", () => {
    const order = examplesFor("order")!.valid.payload as { line_items: { status: string; quantity: Record<string, number> }[] };
    const mk = (status: string, q: object) => ({ ...order, line_items: [{ ...order.line_items[0], status, quantity: q }] });
    const ok = (s: string, q: object) => orderRules(mk(s, q)).find((r) => r.id === "line-status-derivation")!.ok;
    expect(ok("removed", { original: 2, total: 0, fulfilled: 0 })).toBe(true);
    expect(ok("fulfilled", { original: 2, total: 2, fulfilled: 2 })).toBe(true);
    expect(ok("partial", { original: 3, total: 3, fulfilled: 1 })).toBe(true);
    expect(ok("processing", { original: 2, total: 2, fulfilled: 0 })).toBe(true);
    expect(ok("fulfilled", { original: 2, total: 2, fulfilled: 0 })).toBe(false);
    expect(ok("processing", { original: 2, total: 2, fulfilled: 1 })).toBe(false);
  });
  it("rule functions tolerate garbage input", () => {
    for (const f of [checkoutRules, orderRules, errorRules]) {
      expect(f(null)).toEqual([]);
      expect(f(42)).toEqual([]);
      expect(() => f({ line_items: "x", totals: 5, messages: {} })).not.toThrow();
    }
  });
});

describe("op → target mapping", () => {
  it("maps recorded operations to the schema that describes their bodies", () => {
    expect(targetForOp("create_checkout", "request")).toBe("checkout_create_request");
    expect(targetForOp("create_checkout", "response")).toBe("checkout_response");
    expect(targetForOp("order_event_webhook", "request")).toBe("order");
    expect(targetForOp("get_checkout", "request")).toBeUndefined();
    expect(targetForOp("nonsense", "response")).toBeUndefined();
  });
});

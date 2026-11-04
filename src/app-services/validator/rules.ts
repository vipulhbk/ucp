import { UCP_VERSION } from "@/ucp/constants";

/**
 * Checks that go BEYOND JSON-shape validation. They are not part of any JSON Schema and they are NOT protocol conformance:
 * `spec` rules restate a normative sentence of the pinned specification (with its location); `heuristic` rules are
 * consistency checks this project adds and are labelled as such.
 */
export interface RuleResult {
  id: string;
  level: "spec" | "heuristic" | "info";
  ok: boolean;
  statement: string;
  source: string;
  detail?: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

export function checkoutRules(p: unknown): RuleResult[] {
  if (!isObj(p)) return [];
  const status = p.status;
  const messages = arr(p.messages);
  const errors = messages.filter((m) => m.type === "error");
  const totals = arr(p.totals);
  const out: RuleResult[] = [];

  out.push({
    id: "completed-has-order",
    level: "spec",
    ok: status !== "completed" || isObj(p.order),
    statement: "When status is `completed`, `order` is present.",
    source: "checkout/index.md → Status Values (completed)",
  });
  out.push({
    id: "order-only-when-completed",
    level: "spec",
    ok: status === "complete_in_progress" ? p.order === undefined : true,
    statement: "A `complete_in_progress` response MUST NOT contain `order`.",
    source: "checkout/index.md → Status Values (complete_in_progress)",
  });
  out.push({
    id: "escalation-has-continue-url",
    level: "spec",
    ok: status !== "requires_escalation" || typeof p.continue_url === "string",
    statement: "`continue_url` MUST be provided when status is `requires_escalation`.",
    source: "schemas/shopping/checkout.json → continue_url",
  });
  const blocking = errors.filter((m) => m.severity === "recoverable");
  out.push({
    id: "ready-without-open-errors",
    level: "heuristic",
    ok: status !== "ready_for_complete" || blocking.length === 0,
    statement: "A `ready_for_complete` checkout should carry no recoverable error messages (it is meant to have all necessary information).",
    source: "checkout/index.md → Status Values (ready_for_complete); interpretation, not a quoted rule",
    detail: blocking.length ? blocking.map((m) => `${String(m.code)} at ${String(m.path)}`).join("; ") : undefined,
  });
  const caps = isObj(p.ucp) && isObj(p.ucp.capabilities) ? Object.keys(p.ucp.capabilities) : [];
  out.push({
    id: "response-declares-checkout",
    level: "spec",
    ok: caps.includes("dev.ucp.shopping.checkout"),
    statement: "Every business response includes `ucp.capabilities` naming the active capabilities relevant to the operation (checkout here).",
    source: "overview → Business Requirements (Response Requirements)",
  });
  const total = totals.find((t) => t.type === "total")?.amount;
  const rest = totals.filter((t) => t.type !== "total").reduce((a, t) => a + (typeof t.amount === "number" ? t.amount : 0), 0);
  out.push({
    id: "totals-add-up",
    level: "heuristic",
    ok: typeof total === "number" && total === rest,
    statement: "`total` equals the sum of the other totals (signed, minor units).",
    source: "Not stated by the spec as a formula; a consistency check",
    detail: typeof total === "number" ? `total ${total}, sum of others ${rest}` : "no total entry",
  });
  out.push({
    id: "pinned-version",
    level: "info",
    ok: isObj(p.ucp) && p.ucp.version === UCP_VERSION,
    statement: `The response declares the protocol version this project is pinned to (${UCP_VERSION}).`,
    source: "overview → Protocol Version",
    detail: isObj(p.ucp) ? `ucp.version = ${String(p.ucp.version)}` : undefined,
  });
  return out;
}

export function orderRules(p: unknown): RuleResult[] {
  if (!isObj(p)) return [];
  const out: RuleResult[] = [];
  const bad: string[] = [];
  for (const l of arr(p.line_items)) {
    const q = isObj(l.quantity) ? l.quantity : {};
    const total = Number(q.total);
    const fulfilled = Number(q.fulfilled);
    const want = total === 0 ? "removed" : fulfilled === total ? "fulfilled" : fulfilled > 0 ? "partial" : "processing";
    if (l.status !== want) bad.push(`${String(l.id)}: status ${String(l.status)} but quantities imply ${want}`);
  }
  out.push({
    id: "line-status-derivation",
    level: "spec",
    ok: bad.length === 0,
    statement: "Line item status follows: total==0 → removed; fulfilled==total → fulfilled; fulfilled>0 → partial; else processing.",
    source: "order/index.md → Order Line Item → Status Derivation",
    detail: bad.join("; ") || undefined,
  });
  const orig = arr(p.line_items).filter((l) => isObj(l.quantity) && typeof l.quantity.original === "number" && typeof l.quantity.total === "number" && l.quantity.total > l.quantity.original);
  out.push({
    id: "total-not-above-original",
    level: "heuristic",
    ok: orig.length === 0,
    statement: "`quantity.total` does not exceed `quantity.original` unless the order was edited upward.",
    source: "order/index.md → Line Items (interpretation)",
  });
  out.push({
    id: "snapshot-has-all-parts",
    level: "spec",
    ok: Array.isArray(p.line_items) && isObj(p.fulfillment),
    statement: "An order response is the full current-state snapshot: line items and fulfillment are always present.",
    source: "order/index.md → Operations",
  });
  return out;
}

export function errorRules(p: unknown): RuleResult[] {
  if (!isObj(p)) return [];
  return [
    { id: "error-status", level: "spec", ok: isObj(p.ucp) && p.ucp.status === "error", statement: "An error response without a resource declares `ucp.status: \"error\"`.", source: "checkout/index.md → Error Handling" },
    { id: "unrecoverable-when-no-resource", level: "spec", ok: arr(p.messages).every((m) => m.severity !== undefined), statement: "Every error message carries a `severity`.", source: "checkout/index.md → Error Handling" },
  ];
}

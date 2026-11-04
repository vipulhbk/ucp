import type { ZodIssue } from "zod";
import { toJsonPath } from "@/ucp/validate";
import type { RuleResult } from "./rules";
import { targetById } from "./targets";

export const MAX_PAYLOAD_BYTES = 64 * 1024;

export interface Issue {
  path: string;
  message: string;
  code: string;
  expected?: string;
  received?: string;
  /** The actual value found at `path` in the submitted payload (truncated). */
  actual?: string;
}

export interface Report {
  target: { id: string; label: string; zodName: string; docFile: string; docUrl: string; description: string };
  parse: { ok: true } | { ok: false; message: string };
  schema?: { ok: boolean; issues: Issue[] };
  rules: RuleResult[];
  /** Always present: validation is not conformance. */
  scope: string;
}

export const SCOPE_NOTE =
  "This checks JSON shape against the official schemas (as generated into Zod). It does NOT test protocol behavior: negotiation, status transitions, idempotency, signatures, pricing, or webhook handling. Only the official conformance suite against a live server does that, and it has not been run (see the implementation plan).";

function valueAt(root: unknown, path: (string | number)[]): string | undefined {
  let cur: unknown = root;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  if (cur === undefined) return "(absent)";
  const s = JSON.stringify(cur);
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

/** Zod unions report "Invalid input" with the real reasons nested; surface the closest branch instead. */
function flatten(issue: ZodIssue, root: unknown): Issue[] {
  if (issue.code === "invalid_union") {
    const branches = issue.unionErrors.map((e) => e.issues);
    const best = branches.filter((b) => b.length > 0).sort((a, b) => a.length - b.length || Math.max(...b.map((i) => i.path.length)) - Math.max(...a.map((i) => i.path.length)))[0];
    if (best) return best.flatMap((i) => flatten(i, root));
  }
  const base: Issue = { path: toJsonPath(issue.path), message: issue.message, code: issue.code, actual: valueAt(root, issue.path) };
  if (issue.code === "invalid_type") return [{ ...base, expected: issue.expected, received: issue.received }];
  if (issue.code === "invalid_enum_value") return [{ ...base, expected: issue.options.map(String).join(" | "), received: String(issue.received) }];
  if (issue.code === "invalid_literal") return [{ ...base, expected: JSON.stringify(issue.expected), received: JSON.stringify(issue.received) }];
  if (issue.code === "too_small") return [{ ...base, expected: `at least ${issue.minimum}` }];
  if (issue.code === "too_big") return [{ ...base, expected: `at most ${issue.maximum}` }];
  if (issue.code === "unrecognized_keys") return [{ ...base, message: `Unrecognized key(s): ${issue.keys.join(", ")}` }];
  return [base];
}

export function validateText(targetId: string, text: string): Report | null {
  const t = targetById(targetId);
  if (!t) return null;
  const target = { id: t.id, label: t.label, zodName: t.zodName, docFile: t.docFile, docUrl: t.docUrl, description: t.description };
  if (Buffer.byteLength(text) > MAX_PAYLOAD_BYTES) return { target, parse: { ok: false, message: `Payload exceeds ${MAX_PAYLOAD_BYTES} bytes` }, rules: [], scope: SCOPE_NOTE };
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (e) {
    return { target, parse: { ok: false, message: (e as Error).message }, rules: [], scope: SCOPE_NOTE };
  }
  const r = t.schema.safeParse(payload);
  const issues = r.success ? [] : r.error.issues.flatMap((i) => flatten(i, payload)).slice(0, 50);
  // Rule checks run even when the schema fails, when the payload is still an object, so the two layers can be compared.
  return { target, parse: { ok: true }, schema: { ok: r.success, issues }, rules: t.rules?.(payload) ?? [], scope: SCOPE_NOTE };
}

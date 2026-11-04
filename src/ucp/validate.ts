import type { ZodTypeAny, ZodIssue } from "zod";

export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}

export interface ValidationOutcome {
  ok: boolean;
  schema: string;
  issues: ValidationIssue[];
}

/** JSON-path-ish rendering: ["ucp","capabilities",0] → $.ucp.capabilities[0] */
export function toJsonPath(path: (string | number)[]): string {
  return path.reduce<string>((acc, seg) => (typeof seg === "number" ? `${acc}[${seg}]` : /^[A-Za-z_][\w-]*$/.test(seg) ? `${acc}.${seg}` : `${acc}["${seg}"]`), "$");
}

export function issuesOf(issues: ZodIssue[]): ValidationIssue[] {
  return issues.map((i) => ({ path: toJsonPath(i.path), message: i.message, code: i.code }));
}

export function validateWith(schemaName: string, schema: ZodTypeAny, payload: unknown): ValidationOutcome {
  const r = schema.safeParse(payload);
  return r.success ? { ok: true, schema: schemaName, issues: [] } : { ok: false, schema: schemaName, issues: issuesOf(r.error.issues) };
}

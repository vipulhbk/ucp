import { UCP_VERSION } from "./constants";

/** Negotiation/transport/protocol error codes with the HTTP status the spec assigns (overview → Error Codes). */
export const SPEC_ERROR_HTTP = {
  invalid_profile_url: 400,
  profile_unreachable: 424,
  profile_malformed: 422,
  version_unsupported: 422,
  capabilities_incompatible: 200,
  signature_missing: 401,
  signature_invalid: 401,
  key_not_found: 401,
  digest_mismatch: 400,
  algorithm_unsupported: 400,
} as const;

/**
 * Codes the spec does not fix by name for these HTTP statuses (it fixes only the status):
 * names below are demo-chosen and shown as non-normative in the inspector.
 */
export const DEMO_ERROR_HTTP = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  idempotency_conflict: 409,
  rate_limited: 429,
  invalid_request: 400,
  internal_error: 500,
} as const;

export type ErrorCode = keyof typeof SPEC_ERROR_HTTP | keyof typeof DEMO_ERROR_HTTP | (string & {});
export type Severity = "recoverable" | "requires_buyer_input" | "requires_buyer_review" | "unrecoverable";

export function httpStatusFor(code: string): number {
  if (code in SPEC_ERROR_HTTP) return SPEC_ERROR_HTTP[code as keyof typeof SPEC_ERROR_HTTP];
  if (code in DEMO_ERROR_HTTP) return DEMO_ERROR_HTTP[code as keyof typeof DEMO_ERROR_HTTP];
  return 200;
}

export function isNormativeCode(code: string): boolean {
  return code in SPEC_ERROR_HTTP;
}

export interface ErrorBody {
  ucp: { version: string; status: "error"; capabilities?: Record<string, { version: string }[]> };
  messages: { type: "error"; code: string; content: string; severity: Severity; path?: string }[];
  continue_url?: string;
}

export interface ErrorOptions {
  severity?: Severity;
  path?: string;
  continueUrl?: string;
  version?: string;
  capabilities?: Record<string, { version: string }[]>;
}

/** Error envelope for responses that carry no resource (`ucp.status: "error"`). */
export function errorBody(code: string, content: string, opts: ErrorOptions = {}): ErrorBody {
  const body: ErrorBody = {
    ucp: { version: opts.version ?? UCP_VERSION, status: "error" },
    messages: [
      {
        type: "error",
        code,
        content,
        severity: opts.severity ?? "unrecoverable",
        ...(opts.path ? { path: opts.path } : {}),
      },
    ],
  };
  if (opts.capabilities) body.ucp.capabilities = opts.capabilities;
  if (opts.continueUrl) body.continue_url = opts.continueUrl;
  return body;
}

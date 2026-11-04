/**
 * Redaction applied before anything is logged or shown in the inspector.
 * Signature / Signature-Input / Content-Digest / UCP-Agent are public by design and stay visible
 * (needed to explain verification); credentials and PII do not.
 */
const SECRET_HEADERS = new Set(["authorization", "x-api-key", "cookie", "set-cookie", "proxy-authorization", "x-vercel-protection-bypass", "simulation-secret"]);
const SECRET_FIELD = /^(token|credential|credentials|number|pan|cvv|cvc|card_number|secret|password|api_key|access_token|refresh_token|client_secret|authorization)$/i;
const PII_FIELD = /^(email|phone_number|phone|first_name|last_name|street_address|postal_code)$/i;

export const REDACTED = "[REDACTED]";

export function redactHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k] = SECRET_HEADERS.has(k.toLowerCase()) ? REDACTED : v;
  return out;
}

export function maskEmail(v: string): string {
  const at = v.indexOf("@");
  return at > 1 ? `${v[0]}***${v.slice(at)}` : "***";
}

function maskPii(key: string, v: string): string {
  if (/email/i.test(key)) return maskEmail(v);
  if (/phone/i.test(key)) return v.length > 4 ? `${"*".repeat(v.length - 4)}${v.slice(-4)}` : "***";
  return v.length > 1 ? `${v[0]}${"*".repeat(Math.min(v.length - 1, 6))}` : "*";
}

export interface RedactOptions {
  /** Mask PII (buyer name/email/phone/address). On by default for the inspector and exports. */
  maskPii?: boolean;
}

export function redactBody(value: unknown, opts: RedactOptions = {}, key = ""): unknown {
  const mask = opts.maskPii ?? true;
  if (Array.isArray(value)) return value.map((v) => redactBody(v, opts, key));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_FIELD.test(k) && v !== null && typeof v !== "object") out[k] = REDACTED;
      else if (SECRET_FIELD.test(k) && v !== null && typeof v === "object" && k.toLowerCase() === "credential") out[k] = redactCredentialObject(v as Record<string, unknown>);
      else out[k] = redactBody(v, opts, k);
    }
    return out;
  }
  if (mask && typeof value === "string" && PII_FIELD.test(key)) return maskPii(key, value);
  return value;
}

/** Keep the credential's `type` (useful to explain the flow) but never its secret members. */
function redactCredentialObject(c: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) out[k] = k === "type" || k === "binding" ? v : REDACTED;
  return out;
}

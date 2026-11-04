import { createHash, createPublicKey, sign as cryptoSign, timingSafeEqual, verify as cryptoVerify, type JsonWebKey } from "node:crypto";
import { parseDictionary } from "structured-headers";
import { algOfJwk, type SigningKey } from "./keys";

/**
 * RFC 9421 HTTP Message Signatures + RFC 9530 Content-Digest, as profiled by UCP (spec: signatures.md → REST Request
 * Signing / Verification). One signature, label `sig1`. ECDSA uses raw r||s (RFC 9421 §3.3.1), never DER.
 * Interop is cross-checked against an independent implementation in tests/unit/http-signatures.test.ts.
 */
export const SIG_LABEL = "sig1";
export type Headers = Record<string, string>; // lowercase names

export function contentDigest(body: Uint8Array | string): string {
  return `sha-256=:${createHash("sha256").update(body).digest("base64")}:`;
}

const lower = (h: Record<string, string>): Headers => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));

/** Components UCP requires a signature to cover for this message (verify step 2b). */
export function requiredComponents(args: { method?: string; hasQuery?: boolean; hasBody: boolean; headers: Headers; response?: boolean }): string[] {
  if (args.response) return ["@status", ...(args.hasBody ? ["content-digest", "content-type"] : [])];
  const req = ["@method", "@authority", "@path"];
  if (args.hasQuery) req.push("@query");
  if (args.hasBody) req.push("content-digest", "content-type");
  if (args.headers["idempotency-key"]) req.push("idempotency-key");
  if (args.headers["ucp-agent"]) req.push("ucp-agent");
  if (args.headers["signature-agent"]) req.push("signature-agent");
  return req;
}

function componentValue(c: string, m: { method?: string; url?: URL; status?: number; headers: Headers }): string {
  switch (c) {
    case "@method":
      return (m.method ?? "").toUpperCase();
    case "@authority":
      return (m.url?.host ?? "").toLowerCase();
    case "@path":
      return m.url?.pathname || "/";
    case "@query":
      return `?${(m.url?.search ?? "").replace(/^\?/, "")}`;
    case "@status":
      return String(m.status ?? "");
    default: {
      const v = m.headers[c.toLowerCase()];
      if (v === undefined) throw new Error(`signed component "${c}" is absent from the message`);
      return v.replace(/\s+/g, " ").trim();
    }
  }
}

function sigParams(components: string[], p: { keyid: string; created?: number; expires?: number }): string {
  return `(${components.map((c) => `"${c}"`).join(" ")})${p.created !== undefined ? `;created=${p.created}` : ""}${p.expires !== undefined ? `;expires=${p.expires}` : ""};keyid="${p.keyid}"`;
}

function signatureBase(components: string[], m: Parameters<typeof componentValue>[1], params: string): string {
  return [...components.map((c) => `"${c}": ${componentValue(c, m)}`), `"@signature-params": ${params}`].join("\n");
}

export interface SignRequestInput {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Uint8Array | string;
  key: SigningKey;
  /** Extra header components to cover (e.g. webhook-id, webhook-timestamp). */
  extraComponents?: string[];
  created?: number;
  expires?: number;
}

/** Returns the headers to add: Content-Digest (when a body exists), Signature-Input, Signature. */
export function signRequest(i: SignRequestInput): Headers {
  const headers = lower(i.headers);
  const url = new URL(i.url);
  const hasBody = i.body !== undefined && (typeof i.body === "string" ? i.body.length > 0 : i.body.length > 0);
  const out: Headers = {};
  if (hasBody) {
    out["content-digest"] = contentDigest(i.body!);
    headers["content-digest"] = out["content-digest"];
  }
  const components = [...new Set([...requiredComponents({ hasQuery: url.search.length > 1, hasBody, headers }), ...(i.extraComponents ?? [])])];
  const params = sigParams(components, { keyid: i.key.kid, created: i.created ?? Math.floor(Date.now() / 1000), expires: i.expires });
  const base = Buffer.from(signatureBase(components, { method: i.method, url, headers }, params));
  const sig = i.key.alg === "ES256" ? cryptoSign("sha256", base, { key: i.key.privateKey, dsaEncoding: "ieee-p1363" }) : cryptoSign(null, base, i.key.privateKey);
  out["signature-input"] = `${SIG_LABEL}=${params}`;
  out["signature"] = `${SIG_LABEL}=:${sig.toString("base64")}:`;
  return out;
}

export type VerifyFailure =
  | "signature_missing"
  | "signature_malformed"
  | "key_not_found"
  | "algorithm_unsupported"
  | "coverage_insufficient"
  | "digest_mismatch"
  | "signature_invalid"
  | "signature_expired";

/** HTTP status the spec assigns (overview → Error Codes → Signature Errors). */
export const VERIFY_HTTP: Record<VerifyFailure, number> = {
  signature_missing: 401,
  signature_malformed: 400,
  key_not_found: 401,
  algorithm_unsupported: 400,
  coverage_insufficient: 401,
  digest_mismatch: 400,
  signature_invalid: 401,
  signature_expired: 401,
};

export type VerifyResult = { ok: true; keyid: string; alg: string; components: string[]; created?: number } | { ok: false; reason: VerifyFailure; detail: string };

export interface PublicKeyLike {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
  use?: string;
  key_ops?: string[];
}

export interface VerifyRequestInput {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Uint8Array | string;
  /** Looks the key up by `keyid` in the signer's published `keys[]`. */
  resolveKey: (kid: string) => PublicKeyLike | undefined;
  /** Components the *application* additionally demands be covered (e.g. webhook-id). */
  requireComponents?: string[];
  nowSec?: number;
  maxAgeSec?: number;
}

/** Split a Structured Field dictionary on top-level commas (outside quotes and parentheses). */
function topLevelMembers(header: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (const ch of header) {
    if (ch === '"') inStr = !inStr;
    else if (!inStr && ch === "(") depth++;
    else if (!inStr && ch === ")") depth--;
    if (ch === "," && !inStr && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function verifyRequest(i: VerifyRequestInput): VerifyResult {
  const headers = lower(i.headers);
  const rawInput = headers["signature-input"];
  const rawSig = headers["signature"];
  if (!rawInput || !rawSig) return { ok: false, reason: "signature_missing", detail: "Signature-Input and Signature are required" };

  let components: string[];
  let params: Map<string, unknown>;
  let paramString: string;
  let sigBytes: Buffer;
  try {
    const dict = parseDictionary(rawInput);
    const sigDict = parseDictionary(rawSig);
    const label = [...dict.keys()].find((k) => sigDict.has(k));
    if (!label) return { ok: false, reason: "signature_malformed", detail: "no signature label is present in both headers" };
    const [inner, p] = dict.get(label) as unknown as [[string, unknown][], Map<string, unknown>];
    components = inner.map(([c]) => String(c));
    params = p;
    const member = topLevelMembers(rawInput).find((m) => m.startsWith(`${label}=`));
    paramString = member!.slice(label.length + 1);
    const v = (sigDict.get(label) as unknown as [ArrayBuffer])[0];
    if (!(v instanceof ArrayBuffer)) return { ok: false, reason: "signature_malformed", detail: "Signature value must be a byte sequence" };
    sigBytes = Buffer.from(v);
  } catch (e) {
    return { ok: false, reason: "signature_malformed", detail: (e as Error).message };
  }

  const keyid = params.get("keyid");
  if (typeof keyid !== "string") return { ok: false, reason: "signature_malformed", detail: "keyid parameter is required" };
  const jwk = i.resolveKey(keyid);
  if (!jwk || jwk.use === "enc" || (jwk.key_ops && !jwk.key_ops.includes("verify"))) return { ok: false, reason: "key_not_found", detail: `key ${keyid} is not published for signature verification` };
  const alg = algOfJwk(jwk);
  if (!alg) return { ok: false, reason: "algorithm_unsupported", detail: `unsupported key type ${jwk.kty}/${jwk.crv}` };

  const url = new URL(i.url);
  const hasBody = i.body !== undefined && (typeof i.body === "string" ? i.body.length > 0 : i.body.length > 0);
  const required = [...new Set([...requiredComponents({ hasQuery: url.search.length > 1, hasBody, headers }), ...(i.requireComponents ?? [])])];
  const missing = required.filter((c) => !components.includes(c));
  if (missing.length) return { ok: false, reason: "coverage_insufficient", detail: `signature does not cover: ${missing.join(", ")}` };

  if (components.includes("content-digest")) {
    const want = Buffer.from(contentDigest(i.body ?? ""));
    const got = Buffer.from(headers["content-digest"] ?? "");
    if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "digest_mismatch", detail: "Content-Digest does not match the body bytes" };
  }

  let base: Buffer;
  try {
    base = Buffer.from(signatureBase(components, { method: i.method, url, headers }, paramString));
  } catch (e) {
    return { ok: false, reason: "signature_malformed", detail: (e as Error).message };
  }
  const pub = createPublicKey({ key: jwk as JsonWebKey, format: "jwk" });
  let valid = false;
  try {
    valid = alg === "ES256" ? cryptoVerify("sha256", base, { key: pub, dsaEncoding: "ieee-p1363" }, sigBytes) : cryptoVerify(null, base, pub, sigBytes);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "signature_invalid", detail: "signature does not verify against the published key" };

  const now = i.nowSec ?? Math.floor(Date.now() / 1000);
  const created = typeof params.get("created") === "number" ? (params.get("created") as number) : undefined;
  const expires = typeof params.get("expires") === "number" ? (params.get("expires") as number) : undefined;
  if (created !== undefined && (now - created > (i.maxAgeSec ?? 300) || created - now > 60)) return { ok: false, reason: "signature_expired", detail: `created=${created} is outside the accepted window` };
  if (expires !== undefined && expires < now) return { ok: false, reason: "signature_expired", detail: "signature has expired" };
  return { ok: true, keyid, alg, components, created };
}

import { isIP } from "node:net";

/**
 * Authority binding (spec: overview → Namespace Governance → Authority Binding, Derivation algorithm).
 * A declared `schema` URL's host, reversed label by label, must equal the entity name or be a
 * label-aligned prefix of it. This proves provenance only, not trust.
 */
export type BindingStatus = "valid" | "relaxed" | "invalid";

export interface BindingResult {
  status: BindingStatus;
  /** Machine-readable rule that decided the outcome. */
  rule: "exact" | "prefix" | "relaxed_demo" | "bad_url" | "not_https" | "userinfo" | "ip_literal" | "single_label" | "mismatch";
  reason: string;
  host?: string;
  authorityPrefix?: string;
  /** Spec caution that does not change the verdict (e.g. the host is under a public suffix). */
  warning?: string;
}

/** Public suffixes under which unrelated parties register subdomains; the spec says to avoid declaring entities there. */
const PUBLIC_SUFFIX_HINTS = ["vercel.app", "github.io", "netlify.app", "pages.dev", "herokuapp.com", "azurewebsites.net"];

export interface BindingOptions {
  /**
   * Hosts for which a failed binding is reported as `relaxed` instead of `invalid`.
   * This is a documented demo deviation (localhost / *.vercel.app cannot be valid authorities);
   * it is never applied silently — the result carries status `relaxed`.
   */
  relaxedHosts?: readonly string[];
}

function normalizeHost(hostname: string): string {
  let h = hostname.toLowerCase();
  if (h.endsWith(".")) h = h.slice(0, -1);
  return h;
}

export function checkAuthorityBinding(name: string, schemaUrl: string, opts: BindingOptions = {}): BindingResult {
  let url: URL;
  try {
    url = new URL(schemaUrl);
  } catch {
    return { status: "invalid", rule: "bad_url", reason: "schema URL does not parse as a URL" };
  }
  if (url.protocol !== "https:") {
    return maybeRelax(opts, url, { status: "invalid", rule: "not_https", reason: "schema URL must use https" });
  }
  if (url.username !== "" || url.password !== "") {
    return { status: "invalid", rule: "userinfo", reason: "schema URL must not contain userinfo", host: normalizeHost(url.hostname) };
  }
  // WHATWG parsing yields the real host (so https://ucp.dev@evil.example/x has host evil.example) and
  // already converts IDNs to punycode and decimal/hex IPv4 to dotted form.
  const host = normalizeHost(url.hostname);
  if (isIP(host) !== 0 || host.startsWith("[")) {
    return maybeRelax(opts, url, { status: "invalid", rule: "ip_literal", reason: "IP-literal hosts are invalid authorities", host });
  }
  const labels = host.split(".");
  if (labels.length < 2) {
    return maybeRelax(opts, url, { status: "invalid", rule: "single_label", reason: "host must have at least two labels", host });
  }
  const authorityPrefix = [...labels].reverse().join(".");
  if (name === authorityPrefix) {
    return { status: "valid", rule: "exact", reason: `name equals reversed host (${authorityPrefix})`, host, authorityPrefix, ...suffixWarning(host) };
  }
  if (name.startsWith(`${authorityPrefix}.`)) {
    return { status: "valid", rule: "prefix", reason: `name is label-aligned under ${authorityPrefix}`, host, authorityPrefix, ...suffixWarning(host) };
  }
  return maybeRelax(opts, url, {
    status: "invalid",
    rule: "mismatch",
    reason: `reversed host "${authorityPrefix}" is neither equal to nor a label-aligned prefix of "${name}"`,
    host,
    authorityPrefix,
  });
}

function suffixWarning(host: string): { warning?: string } {
  const hit = PUBLIC_SUFFIX_HINTS.find((s) => host === s || host.endsWith(`.${s}`));
  return hit
    ? { warning: `host is under the public suffix "${hit}": independent parties can register sibling names, so this proves less than a registrable domain you control (spec advises against it)` }
    : {};
}

function maybeRelax(opts: BindingOptions, url: URL, failed: BindingResult): BindingResult {
  const host = normalizeHost(url.hostname);
  const relaxed = opts.relaxedHosts?.some((h) => normalizeHost(h) === host || host.endsWith(`.${normalizeHost(h)}`));
  if (relaxed) {
    return {
      ...failed,
      status: "relaxed",
      rule: "relaxed_demo",
      reason: `DEMO RELAXATION: would be invalid (${failed.reason}); host "${host}" is a configured demo host`,
    };
  }
  return failed;
}

/** `{reverse-domain}.{service}.{capability}` convention check (overview → Naming Convention). */
export function isValidReverseDomainName(name: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9_-]*[a-z0-9])?){2,}$/.test(name);
}

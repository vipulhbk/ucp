import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import { isIP } from "node:net";
import { isBlockedAddress } from "./ip-policy";

/**
 * The only function allowed to fetch a URL that came from protocol data (profile URIs, schema URLs,
 * webhook URLs). Spec: overview → Authority Binding → Enforcement (no redirects; resolved-address SSRF checks).
 */
export type SafeFetchErrorCode =
  | "invalid_url"
  | "scheme_not_allowed"
  | "userinfo_not_allowed"
  | "not_allowlisted"
  | "blocked_address"
  | "dns_failure"
  | "redirect"
  | "timeout"
  | "too_large"
  | "network";

export class SafeFetchError extends Error {
  constructor(
    public readonly code: SafeFetchErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface SafeFetchOptions {
  method?: "GET" | "POST" | "PUT";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
  maxBytes?: number;
  /** If set, only these origins (scheme://host[:port]) may be fetched. The demo always sets this. */
  allowedOrigins?: readonly string[];
  /**
   * Development only: allow plain http and loopback for these exact hostnames (e.g. "localhost").
   * Must be empty in production; the platform config enforces that.
   */
  devLoopbackHosts?: readonly string[];
  /** Test seam. */
  resolve?: (host: string) => Promise<string[]>;
}

export interface SafeFetchResult {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  durationMs: number;
  resolvedIp: string;
}

const DEFAULT_TIMEOUT = 5_000;
const DEFAULT_MAX_BYTES = 256 * 1024;

async function defaultResolve(host: string): Promise<string[]> {
  const rows = await dns.lookup(host, { all: true, verbatim: true });
  return rows.map((r) => r.address);
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const started = Date.now();
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError("invalid_url", "URL does not parse");
  }
  if (url.username || url.password) throw new SafeFetchError("userinfo_not_allowed", "URL must not contain userinfo");

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const devLoopback = opts.devLoopbackHosts?.includes(hostname) ?? false;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && devLoopback)) {
    throw new SafeFetchError("scheme_not_allowed", `scheme ${url.protocol} not allowed`);
  }
  if (opts.allowedOrigins && !opts.allowedOrigins.includes(url.origin)) {
    throw new SafeFetchError("not_allowlisted", `origin ${url.origin} is not in the demo allowlist`);
  }

  // Resolve first, judge every address, then pin the connection to the vetted address (defeats DNS rebinding).
  let addresses: string[];
  try {
    addresses = isIP(hostname) ? [hostname] : await (opts.resolve ?? defaultResolve)(hostname);
  } catch (e) {
    throw new SafeFetchError("dns_failure", `DNS lookup failed: ${(e as Error).message}`);
  }
  if (addresses.length === 0) throw new SafeFetchError("dns_failure", "no addresses");
  if (!devLoopback) {
    const bad = addresses.find(isBlockedAddress);
    if (bad) throw new SafeFetchError("blocked_address", `resolved address ${bad} is not publicly routable`);
  }
  // Every address was vetted above; prefer IPv4 (dual-stack hosts such as localhost list ::1 first).
  const ip = addresses.find((a) => isIP(a) === 4) ?? addresses[0]!;
  const family = isIP(ip);
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const mod = url.protocol === "https:" ? https : http;

  return new Promise<SafeFetchResult>((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: opts.method ?? "GET",
        headers: { accept: "application/json", ...opts.headers },
        // Pin to the vetted IP; TLS SNI/cert validation still uses the hostname.
        lookup: (_h, _o, cb) => (_o && (_o as { all?: boolean }).all ? cb(null, [{ address: ip, family }] as never, undefined as never) : cb(null, ip, family)),
        servername: isIP(hostname) ? undefined : hostname,
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          reject(new SafeFetchError("redirect", `redirects are not followed (HTTP ${status})`, status));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy();
            reject(new SafeFetchError("too_large", `response exceeded ${maxBytes} bytes`, status));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) headers[k] = Array.isArray(v) ? v.join(", ") : (v ?? "");
          resolve({ status, headers, bodyText: Buffer.concat(chunks).toString("utf8"), durationMs: Date.now() - started, resolvedIp: ip });
        });
        res.on("error", (e) => reject(new SafeFetchError("network", e.message)));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new SafeFetchError("timeout", `timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT} ms`));
    });
    req.on("error", (e) => reject(e instanceof SafeFetchError ? e : new SafeFetchError("network", e.message)));
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

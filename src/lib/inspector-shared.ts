/**
 * Only read-only platform → business operations can be replayed from the (redacted) log. The log's bodies are masked, so a
 * state-changing call cannot be reproduced faithfully, and repeating it could change state. Shared by the server (which
 * enforces it) and the UI (which only offers Replay where it will be accepted).
 */
export const SAFE_REPLAY_OPS = ["get_profile", "get_checkout", "get_order", "search_catalog", "lookup_catalog"] as const;
export const isReplayable = (actor: string, op: string): boolean => actor === "platform" && (SAFE_REPLAY_OPS as readonly string[]).includes(op);

/** `curl` for a recorded request. Credentials were redacted at write time; they become placeholders you fill in yourself. */
export function toCurl(r: { method: string; url: string; requestHeaders: Record<string, string>; requestBody?: unknown }): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const parts = [`curl -X ${r.method} ${q(r.url)}`];
  for (const [k, v] of Object.entries(r.requestHeaders)) {
    if (["host", "content-length", "connection", "accept-encoding"].includes(k.toLowerCase())) continue;
    parts.push(`-H ${q(`${k}: ${v === "[REDACTED]" ? `$${k.toUpperCase().replace(/-/g, "_")}` : v}`)}`);
  }
  if (r.requestBody !== undefined) parts.push(`-d ${q(JSON.stringify(r.requestBody))}`);
  return parts.join(" \\\n  ");
}

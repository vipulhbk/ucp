/**
 * Origins the platform may contact. Demo fixtures only; arbitrary URL fetching is intentionally impossible (SSRF).
 * Extra origins can be added with DEMO_MERCHANT_ORIGINS (comma-separated, https only in production).
 */
export function demoOrigins(self: string): string[] {
  const extra = (process.env.DEMO_MERCHANT_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  return [...new Set([self.replace(/\/$/, ""), ...extra])];
}

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Demo platform credential (the spec's "API key" authentication mechanism, X-API-Key).
 * key = plk_<platformId>.<hmac(secret, platformId)>. platformId is derived from the demo session id, so the merchant
 * can scope data to the originating platform without sharing the session cookie value.
 */
export const platformIdFor = (sid: string): string => createHash("sha256").update(`platform:${sid}`).digest("hex").slice(0, 24);

const mac = (secret: string, platformId: string) => createHmac("sha256", secret).update(platformId).digest("base64url").slice(0, 32);

export function issueApiKey(secret: string, platformId: string): string {
  return `plk_${platformId}.${mac(secret, platformId)}`;
}

export function verifyApiKey(secret: string, key: string | null | undefined): string | null {
  if (!key?.startsWith("plk_")) return null;
  const [platformId, given] = key.slice(4).split(".");
  if (!platformId || !given || !/^[a-f0-9]{24}$/.test(platformId)) return null;
  const want = mac(secret, platformId);
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b) ? platformId : null;
}

import "server-only";
import { getConfig } from "@/config";
import { demoSigningKey, signingKeyFromJwk, type SigningKey } from "@/ucp/keys";

let key: SigningKey | undefined;

/** Merchant webhook signing key: env JWK, else the published demo key (refused in production unless opted in). */
export function getMerchantSigningKey(): SigningKey {
  if (key) return key;
  const jwk = process.env.MERCHANT_SIGNING_JWK;
  if (jwk) return (key = signingKeyFromJwk(jwk));
  const cfg = getConfig();
  if (cfg.isProduction && process.env.ALLOW_DEMO_KEY !== "true") {
    throw new Error("MERCHANT_SIGNING_JWK is not set. Run `npm run keys:generate`, or set ALLOW_DEMO_KEY=true to publish the demo key (not secret).");
  }
  return (key = demoSigningKey());
}

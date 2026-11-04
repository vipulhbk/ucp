import "server-only";
import { resolveOrigin } from "@/config";
import { buildBusinessProfile, type UcpProfile } from "@/ucp/profile";
import { getMerchantSigningKey } from "./signing-key";

export function businessProfileFor(req?: Request): UcpProfile {
  return buildBusinessProfile({
    origin: resolveOrigin(req),
    keys: [getMerchantSigningKey().publicJwk],
    handlerNameOverride: process.env.UCP_NAMESPACE ? `${process.env.UCP_NAMESPACE}.mock_tokenizer` : undefined,
  });
}


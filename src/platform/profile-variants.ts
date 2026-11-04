import { CAP, UCP_VERSION } from "@/ucp/constants";
import { buildPlatformProfile, capabilityEntry, V1_BUSINESS_CAPABILITIES, type UcpProfile } from "@/ucp/profile";

/**
 * Platform profile fixtures. Each one is a valid (or, for `malformed`, deliberately invalid) platform profile that
 * produces a distinct negotiation outcome. They are labelled fixtures everywhere they appear.
 */
export const PLATFORM_VARIANTS = {
  default: "Compatible platform: same capabilities and version as the business.",
  "no-discount": "Platform without the discount extension: it is excluded from the intersection.",
  "no-fulfillment": "Platform without the fulfillment extension: checkout cannot collect shipping and escalates to the buyer.",
  "discount-skew": "Platform advertises discount at version 2026-01-11: no mutual version, so discount is excluded.",
  "no-order": "Platform without the order capability: no webhook_url, so the business pushes no events (and Get Order is incompatible).",
  "with-cart": "Platform also advertises dev.ucp.shopping.cart, which the business does not offer.",
  "old-version": "Platform speaks only protocol version 2026-01-11: the business rejects it with version_unsupported.",
  malformed: "Deliberately invalid platform profile: the business rejects it with profile_malformed.",
} as const;
export type PlatformVariant = keyof typeof PLATFORM_VARIANTS;

export function isPlatformVariant(v: string | null | undefined): v is PlatformVariant {
  return !!v && Object.hasOwn(PLATFORM_VARIANTS, v);
}

export const PLATFORM_ID_RE = /^[a-f0-9]{24}$/;

/** Per-platform webhook URL: the receiver learns which demo platform an event is for from the path. */
export const webhookUrlFor = (origin: string, platformId?: string | null) => `${origin}/api/platform/webhooks/orders/${platformId && PLATFORM_ID_RE.test(platformId) ? platformId : "anonymous"}`;

export function platformProfileFor(origin: string, variant: PlatformVariant = "default", handlerNameOverride?: string, platformId?: string | null): unknown {
  const webhookUrl = webhookUrlFor(origin, platformId);
  const base = { origin, webhookUrl, handlerNameOverride };
  switch (variant) {
    case "no-discount":
      return buildPlatformProfile({ ...base, capabilities: V1_BUSINESS_CAPABILITIES.filter((c) => c !== CAP.discount) });
    case "no-fulfillment":
      return buildPlatformProfile({ ...base, capabilities: V1_BUSINESS_CAPABILITIES.filter((c) => c !== CAP.fulfillment) });
    case "no-order":
      return buildPlatformProfile({ ...base, capabilities: V1_BUSINESS_CAPABILITIES.filter((c) => c !== CAP.order) });
    case "discount-skew":
      return buildPlatformProfile({ ...base, capabilityVersions: { [CAP.discount]: "2026-01-11" } });
    case "old-version":
      return buildPlatformProfile({ ...base, version: "2026-01-11" });
    case "with-cart": {
      const p: UcpProfile = buildPlatformProfile(base);
      p.ucp.capabilities![CAP.cart] = [capabilityEntry(CAP.cart)];
      return p;
    }
    case "malformed":
      return { ucp: { version: UCP_VERSION, services: [], capabilities: "none" } };
    default:
      return buildPlatformProfile(base);
  }
}

/** Platform versions the discovery client will offer for each fixture. */
export function platformSupportedVersions(variant: PlatformVariant): string[] {
  return variant === "old-version" ? ["2026-01-11"] : [UCP_VERSION];
}

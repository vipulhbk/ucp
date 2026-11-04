/** Pinned protocol release. Never "latest", never a draft (spec: overview → Pre-release Versions). */
export const UCP_VERSION = "2026-08-25" as const;
export const UCP_SPEC_BASE = `https://ucp.dev/${UCP_VERSION}` as const;

export const SERVICE_SHOPPING = "dev.ucp.shopping" as const;

export const CAP = {
  checkout: "dev.ucp.shopping.checkout",
  fulfillment: "dev.ucp.shopping.fulfillment",
  discount: "dev.ucp.shopping.discount",
  order: "dev.ucp.shopping.order",
  catalogSearch: "dev.ucp.shopping.catalog.search",
  catalogLookup: "dev.ucp.shopping.catalog.lookup",
  cart: "dev.ucp.shopping.cart",
  identityLinking: "dev.ucp.common.identity_linking",
} as const;

export type CapabilityName = (typeof CAP)[keyof typeof CAP];

/** Official schema/spec URLs for a `dev.ucp.*` capability at the pinned release. */
export const OFFICIAL_CAPABILITY_REFS: Record<string, { spec: string; schema: string; extends?: string | string[] }> = {
  [CAP.checkout]: {
    spec: `${UCP_SPEC_BASE}/specification/shopping/checkout`,
    schema: `${UCP_SPEC_BASE}/schemas/shopping/checkout.json`,
  },
  [CAP.fulfillment]: {
    spec: `${UCP_SPEC_BASE}/specification/shopping/extensions/fulfillment`,
    schema: `${UCP_SPEC_BASE}/schemas/shopping/fulfillment.json`,
    extends: CAP.checkout,
  },
  [CAP.discount]: {
    spec: `${UCP_SPEC_BASE}/specification/shopping/extensions/discount`,
    schema: `${UCP_SPEC_BASE}/schemas/shopping/discount.json`,
    extends: [CAP.checkout, CAP.cart],
  },
  [CAP.cart]: {
    spec: `${UCP_SPEC_BASE}/specification/shopping/cart`,
    schema: `${UCP_SPEC_BASE}/schemas/shopping/cart.json`,
  },
  [CAP.order]: {
    spec: `${UCP_SPEC_BASE}/specification/shopping/order`,
    schema: `${UCP_SPEC_BASE}/schemas/shopping/order.json`,
  },
  [CAP.catalogSearch]: {
    spec: `${UCP_SPEC_BASE}/specification/shopping/catalog/search`,
    schema: `${UCP_SPEC_BASE}/schemas/shopping/catalog_search.json`,
  },
  [CAP.catalogLookup]: {
    spec: `${UCP_SPEC_BASE}/specification/shopping/catalog/lookup`,
    schema: `${UCP_SPEC_BASE}/schemas/shopping/catalog_lookup.json`,
  },
};

export const SHOPPING_REST_SERVICE = {
  spec: `${UCP_SPEC_BASE}/specification/overview/`,
  schema: `${UCP_SPEC_BASE}/services/shopping/rest.openapi.json`,
} as const;

/**
 * Single import point for the official generated Zod schemas (vendored, see src/vendor/ucp-sdk/PROVENANCE.md).
 * Everything that validates protocol payloads imports from here, so swapping to the npm package later is one edit.
 */
export {
  ProfileBusinessSchema,
  ProfilePlatformSchema,
  CheckoutSchema,
  CheckoutCreateRequestSchema,
  CheckoutUpdateRequestSchema,
  CheckoutCompleteRequestSchema,
  OrderSchema,
  ErrorResponseSchema,
  CatalogSearchRequestSchema,
  CatalogSearchResponseSchema,
  CatalogLookupRequestSchema,
  CatalogLookupResponseSchema,
} from "@/vendor/ucp-sdk/spec_generated";

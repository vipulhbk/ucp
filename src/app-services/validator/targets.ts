import type { ZodTypeAny } from "zod";
import checkoutDoc from "@/vendor/ucp-schemas/shopping/checkout.json";
import catalogLookupDoc from "@/vendor/ucp-schemas/shopping/catalog_lookup.json";
import catalogSearchDoc from "@/vendor/ucp-schemas/shopping/catalog_search.json";
import orderDoc from "@/vendor/ucp-schemas/shopping/order.json";
import profileDoc from "@/vendor/ucp-schemas/profile.json";
import errorDoc from "@/vendor/ucp-schemas/common/types/error_response.json";
import { UCP_VERSION } from "@/ucp/constants";
import { CatalogSearchRequestSchema, CatalogSearchResponseSchema, CheckoutCompleteRequestSchema, CheckoutCreateRequestSchema, CheckoutSchema, CheckoutUpdateRequestSchema, ErrorResponseSchema, OrderSchema, ProfileBusinessSchema, ProfilePlatformSchema } from "@/ucp/schemas";
import { checkoutRules, errorRules, orderRules, type RuleResult } from "./rules";

export interface Target {
  id: string;
  label: string;
  direction: "request" | "response" | "profile";
  /** Name of the generated Zod schema that performs the validation. */
  zodName: string;
  schema: ZodTypeAny;
  /** Official source document shown as the "expected schema". */
  doc: unknown;
  docFile: string;
  docUrl: string;
  description: string;
  rules?: (payload: unknown) => RuleResult[];
}

const u = (path: string) => `https://ucp.dev/${UCP_VERSION}/schemas/${path}`;

export const TARGETS: Target[] = [
  { id: "business_profile", label: "Business profile (/.well-known/ucp)", direction: "profile", zodName: "ProfileBusinessSchema", schema: ProfileBusinessSchema, doc: profileDoc, docFile: "profile.json", docUrl: u("profile.json"), description: "What a business publishes for discovery." },
  { id: "platform_profile", label: "Platform profile (UCP-Agent URL)", direction: "profile", zodName: "ProfilePlatformSchema", schema: ProfilePlatformSchema, doc: profileDoc, docFile: "profile.json", docUrl: u("profile.json"), description: "What a platform advertises, including webhook_url for orders." },
  { id: "checkout_create_request", label: "Create Checkout request", direction: "request", zodName: "CheckoutCreateRequestSchema", schema: CheckoutCreateRequestSchema, doc: checkoutDoc, docFile: "shopping/checkout.json", docUrl: u("shopping/checkout.json"), description: "POST /checkout-sessions body (op: create)." },
  { id: "checkout_update_request", label: "Update Checkout request (full replacement)", direction: "request", zodName: "CheckoutUpdateRequestSchema", schema: CheckoutUpdateRequestSchema, doc: checkoutDoc, docFile: "shopping/checkout.json", docUrl: u("shopping/checkout.json"), description: "PUT /checkout-sessions/{id} body (op: update)." },
  { id: "checkout_complete_request", label: "Complete Checkout request", direction: "request", zodName: "CheckoutCompleteRequestSchema", schema: CheckoutCompleteRequestSchema, doc: checkoutDoc, docFile: "shopping/checkout.json", docUrl: u("shopping/checkout.json"), description: "POST …/complete body: payment is required." },
  { id: "checkout_response", label: "Checkout response", direction: "response", zodName: "CheckoutSchema", schema: CheckoutSchema, doc: checkoutDoc, docFile: "shopping/checkout.json", docUrl: u("shopping/checkout.json"), description: "What the business returns for every checkout operation.", rules: checkoutRules },
  { id: "order", label: "Order (Get Order response and webhook payload)", direction: "response", zodName: "OrderSchema", schema: OrderSchema, doc: orderDoc, docFile: "shopping/order.json", docUrl: u("shopping/order.json"), description: "The full current-state order snapshot.", rules: orderRules },
  { id: "catalog_search_request", label: "Catalog search request", direction: "request", zodName: "CatalogSearchRequestSchema", schema: CatalogSearchRequestSchema, doc: catalogSearchDoc, docFile: "shopping/catalog_search.json", docUrl: u("shopping/catalog_search.json"), description: "POST /catalog/search body." },
  { id: "catalog_search_response", label: "Catalog search response", direction: "response", zodName: "CatalogSearchResponseSchema", schema: CatalogSearchResponseSchema, doc: catalogSearchDoc, docFile: "shopping/catalog_search.json", docUrl: u("shopping/catalog_search.json"), description: "Products, prices and availability." },
  { id: "error_response", label: "Error response (no resource)", direction: "response", zodName: "ErrorResponseSchema", schema: ErrorResponseSchema, doc: errorDoc, docFile: "common/types/error_response.json", docUrl: u("common/types/error_response.json"), description: "ucp.status \"error\" with messages and an optional continue_url.", rules: errorRules },
];

// Referenced so the lookup source document stays vendored for the catalog docs link.
export const EXTRA_DOCS = { catalog_lookup: catalogLookupDoc };

export const targetById = (id: string) => TARGETS.find((t) => t.id === id);

/** Which validator target describes the request/response body of a recorded interaction. */
export const OP_TARGETS: Record<string, { request?: string; response?: string }> = {
  create_checkout: { request: "checkout_create_request", response: "checkout_response" },
  update_checkout: { request: "checkout_update_request", response: "checkout_response" },
  complete_checkout: { request: "checkout_complete_request", response: "checkout_response" },
  get_checkout: { response: "checkout_response" },
  cancel_checkout: { response: "checkout_response" },
  get_order: { response: "order" },
  order_event_webhook: { request: "order" },
  search_catalog: { request: "catalog_search_request", response: "catalog_search_response" },
  get_profile: { response: "business_profile" },
};

export const targetForOp = (op: string, direction: "request" | "response"): string | undefined => OP_TARGETS[op]?.[direction];

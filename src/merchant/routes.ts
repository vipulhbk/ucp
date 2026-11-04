import "server-only";
import { CAP } from "@/ucp/constants";
import { errorBody } from "@/ucp/errors";
import {
  CatalogLookupRequestSchema,
  CatalogLookupResponseSchema,
  CatalogSearchRequestSchema,
  CatalogSearchResponseSchema,
  CheckoutCompleteRequestSchema,
  CheckoutCreateRequestSchema,
  CheckoutSchema,
  CheckoutUpdateRequestSchema,
  OrderSchema,
} from "@/ucp/schemas";
import type { CatalogLookupRequest, CatalogSearchRequest, CheckoutCompleteRequest, CheckoutCreateRequest, CheckoutUpdateRequest } from "@/vendor/ucp-sdk/spec_generated";
import { catalogLookup, catalogSearch } from "./catalog/service";
import { cancelCheckout, completeCheckout, createCheckout, getCheckout, updateCheckout } from "./checkout/service";
import { handleUcp } from "./http";
import { getOrder } from "./orders/service";

/** One entry per OpenAPI operation (source/services/shopping/rest.openapi.json). */
export const ops = {
  searchCatalog: (req: Request) => handleUcp(req, { op: "search_catalog", family: "catalog.search", requires: CAP.catalogSearch, auth: "none", requestSchema: CatalogSearchRequestSchema, responseSchema: CatalogSearchResponseSchema }, (ctx, b) => catalogSearch(ctx, b as CatalogSearchRequest)),
  lookupCatalog: (req: Request) => handleUcp(req, { op: "lookup_catalog", family: "catalog.lookup", requires: CAP.catalogLookup, auth: "none", requestSchema: CatalogLookupRequestSchema, responseSchema: CatalogLookupResponseSchema }, (ctx, b) => catalogLookup(ctx, b as CatalogLookupRequest)),
  createCheckout: (req: Request) => handleUcp(req, { op: "create_checkout", family: "checkout", requires: CAP.checkout, auth: "api_key", idempotent: true, requestSchema: CheckoutCreateRequestSchema, responseSchema: CheckoutSchema }, (ctx, b) => createCheckout(ctx, b as CheckoutCreateRequest)),
  getCheckout: (req: Request, id: string) => handleUcp(req, { op: "get_checkout", family: "checkout", requires: CAP.checkout, auth: "api_key", responseSchema: CheckoutSchema }, (ctx) => getCheckout(ctx, id)),
  updateCheckout: (req: Request, id: string) => handleUcp(req, { op: "update_checkout", family: "checkout", requires: CAP.checkout, auth: "api_key", idempotent: true, requestSchema: CheckoutUpdateRequestSchema, responseSchema: CheckoutSchema }, (ctx, b) => updateCheckout(ctx, id, b as CheckoutUpdateRequest)),
  completeCheckout: (req: Request, id: string) => handleUcp(req, { op: "complete_checkout", family: "checkout", requires: CAP.checkout, auth: "api_key", idempotent: true, requestSchema: CheckoutCompleteRequestSchema, responseSchema: CheckoutSchema }, (ctx, b) => completeCheckout(ctx, id, b as CheckoutCompleteRequest)),
  cancelCheckout: (req: Request, id: string) => handleUcp(req, { op: "cancel_checkout", family: "checkout", requires: CAP.checkout, auth: "api_key", idempotent: true, responseSchema: CheckoutSchema }, (ctx) => cancelCheckout(ctx, id)),
  getOrder: (req: Request, id: string) => handleUcp(req, { op: "get_order", family: "order", requires: CAP.order, auth: "api_key", responseSchema: OrderSchema }, (ctx) => getOrder(ctx, id)),
  /**
   * Cart is defined by the spec but NOT offered by this business. The route exists so a platform that advertises
   * `dev.ucp.shopping.cart` receives the spec'd negotiation outcome (`capabilities_incompatible`) instead of a 404.
   */
  cartUnsupported: (req: Request, op: string) =>
    handleUcp(req, { op, family: "cart", requires: CAP.cart, auth: "none" }, () => ({ status: 501, body: errorBody("not_implemented", "Cart is not offered by this business") })),
};

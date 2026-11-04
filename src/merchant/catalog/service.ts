import { CAP, UCP_VERSION } from "@/ucp/constants";
import { relevantCapabilities } from "@/ucp/negotiation";
import type { CatalogLookupRequest, CatalogSearchRequest } from "@/vendor/ucp-sdk/spec_generated";
import type { MerchantCtx, ServiceResult } from "../checkout/types";
import { CURRENCY, type CatalogProduct } from "./data";
import { MAX_LOOKUP_IDS, lookupCatalog, searchCatalog } from "./search";
import { errorBody } from "@/ucp/errors";

function wireProduct(p: CatalogProduct, origin: string, inputs?: Map<string, { id: string; match: string }[]>) {
  const prices = p.variants.map((v) => v.price);
  const price = (amount: number) => ({ amount, currency: CURRENCY });
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    description: { plain: p.description },
    url: `${origin}/catalog#${p.handle}`,
    categories: [{ value: p.category, taxonomy: "merchant" }],
    price_range: { min: price(Math.min(...prices)), max: price(Math.max(...prices)) },
    media: [{ type: "image", url: `${origin}${p.image}`, alt_text: p.title }],
    variants: p.variants
      .filter((v) => !inputs || inputs.has(v.id))
      .map((v) => ({
      id: v.id,
      sku: v.sku,
      title: v.title,
      description: { plain: p.description },
      price: price(v.price),
      availability: { available: v.stock > 0 && !v.delisted, status: v.stock > 0 && !v.delisted ? "in_stock" : "out_of_stock" },
      tags: p.tags,
      ...(inputs ? { inputs: inputs.get(v.id) } : {}),
    })),
    rating: { value: p.rating.value, scale_max: 5, count: p.rating.count },
    tags: p.tags,
  };
}

const visible = (p: CatalogProduct) => !p.variants.every((v) => v.delisted);

export function catalogSearch(ctx: MerchantCtx, body: CatalogSearchRequest): ServiceResult {
  const r = searchCatalog({
    query: body.query,
    priceMin: body.filters?.price?.min,
    priceMax: body.filters?.price?.max,
    categories: body.filters?.categories,
    limit: body.pagination?.limit,
    cursor: body.pagination?.cursor,
  });
  const products = r.products.filter(visible);
  return {
    status: 200,
    body: {
      ucp: { version: UCP_VERSION, capabilities: relevantCapabilities("catalog.search", ctx.active) },
      products: products.map((p) => wireProduct(p, ctx.origin)),
      pagination: { has_next_page: Boolean(r.nextCursor), ...(r.nextCursor ? { cursor: r.nextCursor } : {}), total_count: r.total },
    },
  };
}

export function catalogLookup(ctx: MerchantCtx, body: CatalogLookupRequest): ServiceResult {
  if (body.ids.length > MAX_LOOKUP_IDS) {
    return { status: 400, body: errorBody("request_too_large", `At most ${MAX_LOOKUP_IDS} identifiers per lookup`, { severity: "recoverable" }) };
  }
  const hits = lookupCatalog(body.ids).filter((h) => visible(h.product));
  return {
    status: 200,
    body: {
      ucp: { version: UCP_VERSION, capabilities: relevantCapabilities("catalog.lookup", ctx.active) },
      products: hits.map((h) => wireProduct(h.product, ctx.origin, h.inputs)),
    },
  };
}

export const CATALOG_CAPS = { search: CAP.catalogSearch, lookup: CAP.catalogLookup } as const;

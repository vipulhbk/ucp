import { CURRENCY, PRODUCTS, type CatalogProduct } from "./data";

const STOP = new Set(["a", "an", "the", "me", "find", "show", "get", "buy", "with", "under", "below", "for", "and", "or", "of", "to", "i", "want", "need", "please", "some", "in", "on"]);

export function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9+\- ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
}

function haystack(p: CatalogProduct): string {
  return [p.title, p.description, p.category, ...p.tags].join(" ").toLowerCase();
}

export interface SearchInput {
  query?: string;
  priceMin?: number;
  priceMax?: number;
  categories?: string[];
  limit?: number;
  cursor?: string;
}

export interface SearchResult {
  products: CatalogProduct[];
  total: number;
  nextCursor?: string;
}

/** Score = number of query terms present; every product with score>0 matches. Empty query lists everything. */
export function searchCatalog(input: SearchInput): SearchResult {
  const terms = tokenize(input.query ?? "");
  const scored = PRODUCTS.map((p) => {
    const h = haystack(p);
    const score = terms.length === 0 ? 1 : terms.filter((t) => h.includes(t)).length;
    return { p, score };
  })
    .filter(({ p, score }) => {
      if (score === 0) return false;
      const price = p.variants[0]!.price;
      if (input.priceMin !== undefined && price < input.priceMin) return false;
      if (input.priceMax !== undefined && price > input.priceMax) return false;
      if (input.categories?.length && !input.categories.some((c) => p.category.toLowerCase().startsWith(c.toLowerCase()))) return false;
      return true;
    })
    .sort((a, b) => b.score - a.score || b.p.rating.value - a.p.rating.value || a.p.id.localeCompare(b.p.id));

  const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
  const offset = input.cursor ? Number.parseInt(Buffer.from(input.cursor, "base64url").toString("utf8"), 10) || 0 : 0;
  const page = scored.slice(offset, offset + limit).map((s) => s.p);
  const next = offset + limit;
  return {
    products: page,
    total: scored.length,
    nextCursor: next < scored.length ? Buffer.from(String(next)).toString("base64url") : undefined,
  };
}

export interface LookupHit {
  product: CatalogProduct;
  /** variant id → how each request identifier resolved to it (spec: Client Correlation) */
  inputs: Map<string, { id: string; match: "exact" | "featured" }[]>;
}

export const MAX_LOOKUP_IDS = 50;

/**
 * Lookup by product id, variant id or SKU. Identifiers are deduplicated; a product appearing via several identifiers is
 * returned once; only variants that some identifier resolved to are returned, each with its `inputs` correlation.
 */
export function lookupCatalog(ids: string[]): LookupHit[] {
  const hits = new Map<string, LookupHit>();
  const add = (product: CatalogProduct, variantId: string, id: string, match: "exact" | "featured") => {
    const hit = hits.get(product.id) ?? { product, inputs: new Map() };
    const list = hit.inputs.get(variantId) ?? [];
    list.push({ id, match });
    hit.inputs.set(variantId, list);
    hits.set(product.id, hit);
  };
  for (const id of new Set(ids)) {
    for (const product of PRODUCTS) {
      if (product.id === id) add(product, product.variants[0]!.id, id, "featured");
      for (const v of product.variants) if (v.id === id || v.sku === id) add(product, v.id, id, "exact");
    }
  }
  return [...hits.values()];
}

export { CURRENCY };

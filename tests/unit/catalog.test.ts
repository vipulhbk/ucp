import { describe, expect, it } from "vitest";
import { PRODUCTS } from "@/merchant/catalog/data";
import { lookupCatalog, searchCatalog, tokenize } from "@/merchant/catalog/search";
import { checkLine } from "@/merchant/checkout/service";

describe("catalog search", () => {
  it("finds ANC wireless headphones under ₹5,000 (the headline scenario)", () => {
    const r = searchCatalog({ query: "wireless headphone with noise cancellation", priceMax: 500000 });
    expect(r.products[0]!.id).toBe("prod_aurora_anc");
    expect(r.products.every((p) => p.variants[0]!.price <= 500000)).toBe(true);
    expect(r.products.map((p) => p.id)).not.toContain("prod_summit_pro_anc"); // ₹8,999 exceeds the cap
  });
  it("ranks products matching more terms first", () => {
    const ids = searchCatalog({ query: "wireless noise cancellation headphones" }).products.map((p) => p.id);
    expect(ids.indexOf("prod_aurora_anc")).toBeLessThan(ids.indexOf("prod_pulse_wireless"));
  });
  it("drops stop-words and punctuation", () => expect(tokenize("Find me a wireless headphone, under ₹5,000!")).toEqual(["wireless", "headphone", "5", "000"]));
  it("supports price min/max, categories and pagination with cursors", () => {
    const page1 = searchCatalog({ query: "", limit: 5 });
    expect(page1.products).toHaveLength(5);
    expect(page1.nextCursor).toBeDefined();
    const page2 = searchCatalog({ query: "", limit: 5, cursor: page1.nextCursor });
    expect(page2.products[0]!.id).not.toBe(page1.products[0]!.id);
    expect(page1.total).toBe(PRODUCTS.length);
    expect(searchCatalog({ priceMin: 800000 }).products.every((p) => p.variants[0]!.price >= 800000)).toBe(true);
    expect(searchCatalog({ categories: ["Audio > Speakers"] }).products.every((p) => p.category === "Audio > Speakers")).toBe(true);
  });
  it("lookup accepts product ids, variant ids and SKUs, ignores unknown ids, dedupes, and correlates inputs", () => {
    const hits = lookupCatalog(["prod_aurora_anc", "var_aurora_anc", "var_aurora_anc", "GLIDE-MOUSE", "nope"]);
    expect(hits.map((h) => h.product.id).sort()).toEqual(["prod_aurora_anc", "prod_glide_mouse"]); // one hit per product
    const aurora = hits.find((h) => h.product.id === "prod_aurora_anc")!;
    expect(aurora.inputs.get("var_aurora_anc")).toEqual([{ id: "prod_aurora_anc", match: "featured" }, { id: "var_aurora_anc", match: "exact" }]);
    expect(hits.find((h) => h.product.id === "prod_glide_mouse")!.inputs.get("var_glide_mouse")).toEqual([{ id: "GLIDE-MOUSE", match: "exact" }]);
  });
  it("the demo catalog contains the scenario fixtures (sold out, delisted, low stock)", () => {
    expect(checkLine("var_nova_lamp_limited", 1)?.code).toBe("out_of_stock");
    expect(checkLine("var_retro_discman", 1)?.code).toBe("item_unavailable");
    expect(checkLine("var_studio_monitor_pair", 5)?.code).toBe("out_of_stock");
    expect(checkLine("var_studio_monitor_pair", 4)).toBeNull();
    expect(checkLine("var_glide_mouse", 11)).not.toBeNull();
    expect(checkLine("nope", 1)?.code).toBe("item_unavailable");
  });
});

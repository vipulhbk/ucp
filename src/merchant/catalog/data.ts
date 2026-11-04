/**
 * Deterministic demo catalog. Prices are integer paise (INR minor units), per the spec's amount convention.
 * `stock` is a fixed per-variant limit (never decremented) so demos and tests are repeatable.
 */
export const CURRENCY = "INR" as const;

export interface CatalogVariant {
  id: string; // used as item.id in checkout
  sku: string;
  title: string;
  price: number;
  stock: number;
  /** Delisted: cannot be purchased at all (item_unavailable). */
  delisted?: boolean;
}

export interface CatalogProduct {
  id: string;
  handle: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  rating: { value: number; count: number };
  image: string;
  /** Delivered electronically (a booking voucher): no shipping address or delivery option is collected for it. */
  digital?: boolean;
  variants: CatalogVariant[];
}

const p = (
  id: string,
  title: string,
  description: string,
  category: string,
  tags: string[],
  rating: [number, number],
  price: number,
  stock = 25,
  extra: Partial<CatalogVariant> = {},
): CatalogProduct => ({
  id: `prod_${id}`,
  handle: id.replace(/_/g, "-"),
  title,
  description,
  category,
  tags,
  rating: { value: rating[0], count: rating[1] },
  image: `/catalog/${id}.svg`,
  variants: [{ id: `var_${id}`, sku: id.toUpperCase().replace(/_/g, "-"), title: "Standard", price, stock, ...extra }],
});

export const PRODUCTS: CatalogProduct[] = [
  p("aurora_anc", "Aurora ANC Wireless Headphones", "Over-ear Bluetooth headphones with active noise cancellation and 40-hour battery.", "Audio > Headphones", ["wireless", "bluetooth", "noise cancellation", "anc", "headphones", "over-ear"], [4.4, 1280], 449900),
  p("pulse_wireless", "Pulse Wireless Headphones", "Lightweight Bluetooth on-ear headphones, 30-hour battery. No noise cancellation.", "Audio > Headphones", ["wireless", "bluetooth", "headphones", "on-ear"], [4.1, 860], 299900),
  p("summit_pro_anc", "Summit Pro ANC Headphones", "Premium wireless headphones with adaptive noise cancellation and multipoint pairing.", "Audio > Headphones", ["wireless", "bluetooth", "noise cancellation", "anc", "headphones", "premium"], [4.7, 540], 899900),
  p("drift_neckband_anc", "Drift ANC Neckband Earphones", "Wireless neckband earphones with hybrid noise cancellation.", "Audio > Earphones", ["wireless", "bluetooth", "noise cancellation", "anc", "earphones", "neckband"], [4.0, 312], 329900),
  p("echo_wired_studio", "Echo Wired Studio Headphones", "Wired closed-back studio monitor headphones.", "Audio > Headphones", ["wired", "headphones", "studio"], [4.5, 205], 199900),
  p("boom_speaker", "Boom Portable Bluetooth Speaker", "Water-resistant 20W portable speaker with 12-hour playtime.", "Audio > Speakers", ["wireless", "bluetooth", "speaker", "portable"], [4.2, 940], 249900),
  p("volt_powerbank", "Volt 20000mAh Power Bank", "Fast-charging 20,000 mAh power bank with USB-C PD.", "Accessories > Power", ["power bank", "usb-c", "charging"], [4.3, 1500], 199900),
  p("keystone_keyboard", "Keystone Mechanical Keyboard", "Hot-swappable 75% mechanical keyboard with Bluetooth.", "Computers > Keyboards", ["keyboard", "mechanical", "wireless", "bluetooth"], [4.6, 410], 599900),
  p("glide_mouse", "Glide Wireless Mouse", "Ergonomic wireless mouse with silent clicks.", "Computers > Mice", ["mouse", "wireless", "ergonomic"], [4.2, 720], 99900),
  p("trek_backpack", "Trek 25L Laptop Backpack", "Water-resistant 25-litre backpack with padded laptop sleeve.", "Bags", ["backpack", "laptop", "travel"], [4.4, 330], 179900),
  p("nova_lamp_limited", "Nova Limited-Edition Desk Lamp", "Numbered limited-edition lamp. Currently sold out.", "Home > Lighting", ["lamp", "limited"], [4.9, 88], 349900, 0),
  p("retro_discman", "Retro Portable CD Player", "Discontinued model, no longer sold.", "Audio > Players", ["cd", "retro"], [3.9, 40], 299900, 0, { delisted: true }),
  p("studio_monitor_pair", "Studio Monitor Speaker Pair", "Powered 5-inch studio monitors, pair.", "Audio > Speakers", ["speaker", "studio", "wired"], [4.6, 120], 1499900, 4),
];

/** Bookable travel components for the Trip Genie demo. Digital vouchers, so checkout needs no shipping step. Prices are illustrative. */
const travel = (kind: "stay" | "pass", trip: string, destination: string, title: string, description: string, tags: string[], price: number): CatalogProduct => ({
  id: `prod_${kind}_${trip}`,
  handle: `${kind}-${trip}`,
  title,
  description,
  category: kind === "stay" ? "Travel > Stays" : "Travel > Experiences",
  tags: [kind === "stay" ? "stay" : "experience", "travel", "trip", destination.toLowerCase(), ...tags],
  rating: { value: kind === "stay" ? 4.5 : 4.6, count: 120 + (trip.length * 37) % 300 },
  image: `/trips/${trip}.svg`,
  digital: true,
  variants: [{ id: `var_${kind}_${trip}`, sku: `${kind}-${trip}`.toUpperCase().replace(/_/g, "-"), title: kind === "stay" ? "Package" : "Pass", price, stock: 25 }],
});

export const TRAVEL_PRODUCTS: CatalogProduct[] = [
  travel("stay", "paris", "Paris", "Paris: Left Bank boutique stay, 3 nights", "Three nights in a boutique hotel near Saint-Germain, breakfast included. Demo voucher; not a real reservation.", ["france", "romantic", "art"], 2850000),
  travel("pass", "paris", "Paris", "Paris: Museum and Seine cruise pass", "Skip-the-line museum entries and an evening river cruise. Demo voucher.", ["france", "art", "romantic"], 650000),
  travel("stay", "goa", "Goa", "Goa: Beachside stay, 4 nights", "Four nights in a beach-shack style resort near Calangute, breakfast included. Demo voucher.", ["india", "beaches", "nightlife"], 1400000),
  travel("pass", "goa", "Goa", "Goa: Water sports and sunset cruise pass", "Parasailing, banana boat and a Mandovi sunset cruise. Demo voucher.", ["india", "beaches", "sports"], 450000),
  travel("stay", "jaipur", "Jaipur", "Jaipur: Heritage haveli stay, 3 nights", "Three nights in a restored haveli inside the old city, breakfast included. Demo voucher.", ["india", "art", "shopping"], 1650000),
  travel("pass", "jaipur", "Jaipur", "Jaipur: Forts and crafts guided pass", "Guided Amber Fort visit and a block-printing workshop. Demo voucher.", ["india", "art", "shopping"], 350000),
  travel("stay", "bali", "Bali", "Bali: Ubud villa stay, 5 nights", "Five nights in a private-pool villa in Ubud, breakfast included. Demo voucher.", ["indonesia", "scenic", "romantic"], 2400000),
  travel("pass", "bali", "Bali", "Bali: Temples and rice terraces day tours", "Two guided day tours covering temples and terraced rice fields. Demo voucher.", ["indonesia", "scenic", "art"], 700000),
  travel("stay", "kyoto", "Kyoto", "Kyoto: Machiya townhouse stay, 4 nights", "Four nights in a traditional wooden townhouse in Higashiyama. Demo voucher.", ["japan", "art", "scenic"], 3000000),
  travel("pass", "kyoto", "Kyoto", "Kyoto: Temples and tea experience pass", "Guided temple morning and a tea-ceremony session. Demo voucher.", ["japan", "art"], 600000),
  travel("stay", "singapore", "Singapore", "Singapore: Family suite stay, 4 nights", "Four nights in a family suite near Marina Bay, breakfast included. Demo voucher.", ["kids", "family", "shopping"], 2900000),
  travel("pass", "singapore", "Singapore", "Singapore: Family attractions pass", "Entry to a zoo, a gardens dome and a sea-aquarium for a family of four. Demo voucher.", ["kids", "family"], 800000),
  travel("stay", "manali", "Manali", "Manali: Mountain-view cottage stay, 3 nights", "Three nights in a wooden cottage above the Beas valley, breakfast included. Demo voucher.", ["india", "scenic", "sports"], 950000),
  travel("pass", "manali", "Manali", "Manali: Adventure pack (rafting and paragliding)", "River rafting and a tandem paragliding flight. Demo voucher.", ["india", "sports", "scenic"], 550000),
  travel("stay", "santorini", "Santorini", "Santorini: Caldera-view stay, 4 nights", "Four nights in a cave-style suite in Oia with caldera views. Demo voucher.", ["greece", "romantic", "scenic"], 3300000),
  travel("pass", "santorini", "Santorini", "Santorini: Caldera sunset sailing", "Half-day catamaran sailing with a sunset dinner. Demo voucher.", ["greece", "romantic", "beaches"], 650000),
];

PRODUCTS.push(...TRAVEL_PRODUCTS);

export function findVariant(id: string): { product: CatalogProduct; variant: CatalogVariant } | undefined {
  for (const product of PRODUCTS) {
    const variant = product.variants.find((v) => v.id === id);
    if (variant) return { product, variant };
  }
  return undefined;
}

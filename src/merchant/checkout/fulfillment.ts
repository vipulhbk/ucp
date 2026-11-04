/** Demo shipping rules. Fulfillment options are computed by the merchant from destination and net item value. */
export interface ShippingAddress {
  id: string;
  street_address?: string;
  address_locality?: string;
  address_region?: string;
  address_country?: string;
  postal_code?: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  extended_address?: string;
}

export interface ShippingOptionDef {
  id: "standard" | "express";
  title: string;
  description: string;
  carrier: string;
  amount: number;
  etaDays: [number, number];
}

export const FREE_STANDARD_THRESHOLD = 200_000; // ₹2,000 net of discounts

export function addressProblems(a: ShippingAddress): { path: string; code: "missing" | "invalid" | "address_undeliverable"; content: string }[] {
  const out: { path: string; code: "missing" | "invalid" | "address_undeliverable"; content: string }[] = [];
  for (const f of ["street_address", "address_locality", "address_region", "postal_code", "address_country"] as const) {
    if (!a[f]) out.push({ path: f, code: "missing", content: `${f.replace(/_/g, " ")} is required` });
  }
  if (a.address_country && a.address_country.toUpperCase() !== "IN") {
    out.push({ path: "address_country", code: "address_undeliverable", content: `We only deliver within India (got ${a.address_country})` });
  }
  if (a.address_country?.toUpperCase() === "IN" && a.postal_code && !/^[1-8]\d{5}$/.test(a.postal_code)) {
    out.push({ path: "postal_code", code: "invalid", content: "Indian PIN codes are 6 digits starting with 1–8" });
  }
  return out;
}

export function shippingOptions(netItemValue: number): ShippingOptionDef[] {
  return [
    { id: "standard", title: "Standard Delivery", description: "4–6 business days", carrier: "DemoPost", amount: netItemValue >= FREE_STANDARD_THRESHOLD ? 0 : 9900, etaDays: [4, 6] },
    { id: "express", title: "Express Delivery", description: "1–2 business days", carrier: "DemoExpress", amount: 24900, etaDays: [1, 2] },
  ];
}

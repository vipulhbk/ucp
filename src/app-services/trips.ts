import "server-only";
import { findVariant } from "@/merchant/catalog/data";
import { priceCheckout } from "@/merchant/pricing";
import { TRIPS, tripById } from "@/trips/samples";
import type { Trip } from "@/trips/types";

export interface TripLine {
  variantId: string;
  title: string;
  quantity: number;
  /** Merchant catalog price per unit, in paise. */
  unitPrice: number;
}

export interface TripView extends Trip {
  lines: TripLine[];
  /** What the merchant would charge for the bookable parts (automatic discount and tax included, no shipping), in paise. */
  packageTotal: number;
}

/** Joins a trip with the merchant's catalog prices for display. The checkout recomputes everything; this is only a preview. */
export function viewOf(trip: Trip): TripView {
  const lines = trip.bookables.map((b) => {
    const found = findVariant(b.variantId);
    if (!found) throw new Error(`trip ${trip.id}: unknown catalog variant ${b.variantId}`);
    return { variantId: b.variantId, title: found.product.title, quantity: b.quantity, unitPrice: found.variant.price };
  });
  const { total } = priceCheckout({ lines: lines.map((l, i) => ({ lineId: `l${i}`, itemId: l.variantId, quantity: l.quantity })), codes: [], fulfillmentAmount: 0 });
  return { ...trip, lines, packageTotal: total };
}

export const allTripViews = (): TripView[] => TRIPS.map(viewOf);
export const tripViewById = (id: string): TripView | undefined => {
  const t = tripById(id);
  return t ? viewOf(t) : undefined;
};

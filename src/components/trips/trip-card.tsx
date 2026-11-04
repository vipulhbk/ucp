import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { rupees } from "@/lib/format";
import type { TripView } from "@/app-services/trips";
import { BUDGET_LABEL, INTEREST_LABEL } from "@/trips/types";

/** What a tile needs. Narrower than the full trip so the shelf (a client component) does not ship every itinerary. */
export type TripSummary = Pick<TripView, "id" | "destination" | "country" | "days" | "budgetTier" | "tagline" | "interests" | "cover" | "packageTotal">;

/** One ready-made trip, as a tile. The cover is decorative artwork, not a photograph of the place. */
export function TripCard({ trip, className = "" }: { trip: TripSummary; className?: string }) {
  return (
    <Link href={`/trips/${trip.id}`} className={`ap-card ap-lift group flex flex-col overflow-hidden ${className}`} data-testid="trip-card">
      <div className="ap-zoom relative aspect-[4/3] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- static decorative SVG, no optimisation needed */}
        <img src={trip.cover} alt="" className="size-full object-cover" />
        <span className="ap-glass absolute bottom-3 left-3 rounded-full px-3 py-1 text-xs font-medium text-foreground">{trip.days} days · {BUDGET_LABEL[trip.budgetTier].symbol}</span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-5">
        <div className="text-xs font-medium text-muted-foreground">{trip.country}</div>
        <div className="ap-title text-2xl">{trip.destination}</div>
        <p className="text-sm leading-snug text-muted-foreground">{trip.tagline}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {trip.interests.map((i) => <span key={i} className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">{INTEREST_LABEL[i]}</span>)}
        </div>
        <div className="mt-auto flex items-center justify-between pt-5 text-sm">
          <span className="text-muted-foreground">From <span className="font-semibold text-foreground">{rupees(trip.packageTotal)}</span></span>
          <span className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden><ChevronRight className="size-4" /></span>
        </div>
      </div>
    </Link>
  );
}

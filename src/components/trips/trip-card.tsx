import Link from "next/link";
import { rupees } from "@/lib/format";
import type { TripView } from "@/app-services/trips";
import { BUDGET_LABEL, INTEREST_LABEL } from "@/trips/types";

/** One ready-made trip, as a tile. The cover is decorative artwork, not a photograph of the place. */
export function TripCard({ trip }: { trip: TripView }) {
  return (
    <Link href={`/trips/${trip.id}`} className="ap-card group flex flex-col overflow-hidden transition duration-300 hover:scale-[1.015] focus-visible:outline-2" data-testid="trip-card">
      <div className="relative aspect-[4/3] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- static decorative SVG, no optimisation needed */}
        <img src={trip.cover} alt="" className="size-full object-cover" />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-5">
        <div className="text-xs font-medium text-muted-foreground">{trip.country} · {trip.days} days · {BUDGET_LABEL[trip.budgetTier].symbol}</div>
        <div className="ap-title text-xl">{trip.destination}</div>
        <p className="text-sm text-muted-foreground">{trip.tagline}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {trip.interests.map((i) => <span key={i} className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">{INTEREST_LABEL[i]}</span>)}
        </div>
        <div className="mt-auto flex items-center justify-between pt-4 text-sm">
          <span className="text-muted-foreground">From <span className="font-medium text-foreground">{rupees(trip.packageTotal)}</span></span>
          <span className="ap-link">View &rsaquo;</span>
        </div>
      </div>
    </Link>
  );
}

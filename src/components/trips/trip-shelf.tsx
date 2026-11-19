"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Shuffle } from "lucide-react";
import { INTERESTS, INTEREST_LABEL, type Interest } from "@/trips/types";
import { TripCard, type TripSummary } from "./trip-card";

/** The ready-made trips with interest filters. A swipeable shelf on phones, a grid from the sm breakpoint up. */
export function TripShelf({ trips }: { trips: TripSummary[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Interest | "all">("all");
  const present = INTERESTS.filter((i) => trips.some((t) => t.interests.includes(i)));
  const shown = filter === "all" ? trips : trips.filter((t) => t.interests.includes(filter));
  return (
    <div className="space-y-6">
      <div role="group" aria-label="Filter trips by interest" className="ap-noscrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1 md:mx-0 md:flex-wrap md:px-0">
        {(["all", ...present] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className="ap-chip">{f === "all" ? "All trips" : INTEREST_LABEL[f]}</button>
        ))}
        <button type="button" onClick={() => router.push(`/trips/${shown[Math.floor(Math.random() * shown.length)]!.id}`)} className="ap-chip ap-press inline-flex items-center gap-1.5 !text-primary" data-testid="shelf-surprise">
          <Shuffle className="size-3.5" aria-hidden /> Surprise me
        </button>
      </div>
      <p role="status" className="sr-only">{shown.length} {shown.length === 1 ? "trip" : "trips"} shown</p>
      <div key={filter} className="ap-noscrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4 lg:gap-5">
        {shown.map((t, i) => (
          <div key={t.id} className="ap-rise w-[78vw] max-w-sm shrink-0 snap-center sm:w-auto sm:max-w-none" style={{ "--i": i } as React.CSSProperties}>
            <TripCard trip={t} className="h-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useSearchParams } from "next/navigation";
import { ArchitectureExplorer } from "@/components/architecture/explorer";

/** `?tour=1` opens the page with the guided tour already running. */
export function ArchitectureStart() {
  const tour = useSearchParams().get("tour") === "1";
  return <ArchitectureExplorer startTour={tour} key={tour ? "tour" : "free"} />;
}

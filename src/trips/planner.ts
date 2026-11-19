import { TRIPS } from "./samples";
import { AVOID_NIGHTLIFE, WANTS_KIDS, WANTS_QUIET, norm, rankTrips as rank, type Scored } from "./rank";
import { PlanRequestSchema, type PlanRequest, type PlanResult, type Trip, type TripPlanner } from "./types";

/**
 * The demo planner: no model, no network, no randomness. It scores the ready-made trips against what the traveller asked
 * for and says why. It cannot invent an itinerary, resize a trip or know about places outside the sample set, and it
 * says so in `caveats` rather than pretending. A model-backed planner replaces this by implementing `TripPlanner`.
 */

export const MOCK_PLANNER_NAME = "Rule-based demo planner (no AI model)";

export const rankTrips = (request: PlanRequest, trips: Trip[] = TRIPS): Scored[] => rank(request, trips);

/** True when the destination the traveller typed names this ready-made trip (city, country or nickname). */
export function matchesDestination(request: PlanRequest, trip: Trip): boolean {
  const dest = norm(request.destination);
  return Boolean(dest) && trip.aliases.some((a) => dest.includes(a) || a.includes(dest));
}

function caveatsFor(request: PlanRequest, best: Scored): string[] {
  const out: string[] = [];
  const dest = norm(request.destination);
  const matchedDestination = best.trip.aliases.some((a) => dest.includes(a) || a.includes(dest));
  if (dest && !matchedDestination) {
    out.push(`There is no ready-made trip for "${request.destination.trim()}" yet, so this is the closest match for your interests. A model-backed planner would build one from scratch.`);
  }
  const wanted = norm(request.notes).match(/\b(\d{1,2})\s*(days?|nights?)\b/);
  if (wanted) {
    const n = Number(wanted[1]);
    if (n !== best.trip.days) out.push(`You mentioned ${wanted[0]}; this sample is ${best.trip.days} days long and the demo planner cannot resize it.`);
  }
  if (request.notes.trim() && !AVOID_NIGHTLIFE.test(norm(request.notes)) && !WANTS_KIDS.test(norm(request.notes)) && !WANTS_QUIET.test(norm(request.notes)) && !wanted) {
    out.push("Your free-text notes are only partly understood: the demo planner reads a few keywords (kids, quiet, avoid night life, number of days), not full sentences.");
  }
  if ((request.origin ?? "").trim()) {
    out.push(`You are travelling from ${(request.origin ?? "").trim()}. The demo planner does not plan the journey or suggest other stays; the stay in this trip is the package you can book.`);
  }
  if (!request.destination.trim() && request.interests.length === 0 && !request.budgetTier) {
    out.push("You gave no preferences, so this is simply the first trip in the sample list.");
  }
  return out;
}

export class MockTripPlanner implements TripPlanner {
  async plan(input: PlanRequest): Promise<PlanResult> {
    const request = PlanRequestSchema.parse(input);
    const ranked = rankTrips(request);
    const best = ranked[0]!;
    return {
      trip: best.trip,
      reasons: best.reasons.length ? best.reasons : ["Chosen as a popular starting point."],
      caveats: caveatsFor(request, best),
      source: { kind: "mock", name: MOCK_PLANNER_NAME },
    };
  }
}


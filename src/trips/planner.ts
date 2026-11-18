import { TRIPS } from "./samples";
import { BUDGET_LABEL, INTEREST_LABEL, PlanRequestSchema, type PlanRequest, type PlanResult, type Trip, type TripPlanner } from "./types";

/**
 * The demo planner: no model, no network, no randomness. It scores the ready-made trips against what the traveller asked
 * for and says why. It cannot invent an itinerary, resize a trip or know about places outside the sample set, and it
 * says so in `caveats` rather than pretending. A model-backed planner replaces this by implementing `TripPlanner`.
 */

export const MOCK_PLANNER_NAME = "Rule-based demo planner (no AI model)";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export interface Scored {
  trip: Trip;
  score: number;
  reasons: string[];
}

/** Words in the notes that steer the ranking. Each rule is listed here so the behaviour is easy to read and to test. */
const AVOID_NIGHTLIFE = /\b(no|avoid|exclude|without|skip)\s+(night\s?life|loud|clubs?|parties|party|bars?)\b/;
const WANTS_KIDS = /\b(kids?|child|children|toddlers?|family)\b/;
const WANTS_QUIET = /\b(quiet|peaceful|calm|relax(ed|ing)?|slow)\b/;

export function rankTrips(request: PlanRequest, trips: Trip[] = TRIPS): Scored[] {
  const dest = norm(request.destination);
  const notes = norm(request.notes);
  return trips
    .map((trip, index) => {
      let score = 0;
      const reasons: string[] = [];

      if (dest && trip.aliases.some((a) => dest.includes(a) || a.includes(dest))) {
        score += 100;
        reasons.push(`Matches the destination you typed (${trip.destination}, ${trip.country}).`);
      }

      const shared = request.interests.filter((i) => trip.interests.includes(i));
      if (shared.length) {
        score += shared.length * 20;
        reasons.push(`Covers ${shared.map((i) => INTEREST_LABEL[i].toLowerCase()).join(", ")}.`);
      }

      if (request.budgetTier) {
        const gap = Math.abs(request.budgetTier - trip.budgetTier);
        score -= gap * 8;
        reasons.push(gap === 0 ? `Sits in your budget band (${BUDGET_LABEL[trip.budgetTier].symbol}, ${BUDGET_LABEL[trip.budgetTier].range}).` : `Is ${gap === 1 ? "one band" : `${gap} bands`} away from your budget (${BUDGET_LABEL[trip.budgetTier].symbol}).`);
      }

      if (AVOID_NIGHTLIFE.test(notes) && trip.interests.includes("nightlife")) {
        score -= 25;
        reasons.push("Ranked lower: your notes ask to avoid night life and this trip includes it.");
      }
      if (WANTS_KIDS.test(notes) && trip.interests.includes("kids")) {
        score += 15;
        reasons.push("Suits children, as your notes mention.");
      }
      if (WANTS_QUIET.test(notes) && trip.interests.includes("scenic")) {
        score += 8;
        reasons.push("Leans quiet and scenic, as your notes suggest.");
      }

      return { trip, score, reasons, index };
    })
    // Ties keep the order of the sample list, so an empty request deterministically gets the first trip.
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ trip, score, reasons }) => ({ trip, score, reasons }));
}

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


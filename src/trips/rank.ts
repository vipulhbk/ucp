import { BUDGET_LABEL, INTEREST_LABEL, type PlanRequest, type Trip } from "./types";

/**
 * Trip ranking, shared by the server planner and the planner form (which previews the ranking as the traveller chooses).
 * It imports no sample data, so the browser can rank a slim list of trips without shipping every itinerary.
 */

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export interface Scored<T extends Rankable = Trip> {
  trip: T;
  score: number;
  reasons: string[];
}

/** Words in the notes that steer the ranking. Each rule is listed here so the behaviour is easy to read and to test. */
export const AVOID_NIGHTLIFE = /\b(no|avoid|exclude|without|skip)\s+(night\s?life|loud|clubs?|parties|party|bars?)\b/;
export const WANTS_KIDS = /\b(kids?|child|children|toddlers?|family)\b/;
export const WANTS_QUIET = /\b(quiet|peaceful|calm|relax(ed|ing)?|slow)\b/;

/** The fields ranking reads, so the browser can rank a slim list of trips without shipping every itinerary. */
export type Rankable = Pick<Trip, "aliases" | "interests" | "budgetTier" | "destination" | "country">;

export function rankTrips<T extends Rankable = Trip>(request: PlanRequest, trips: T[]): Scored<T>[] {
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

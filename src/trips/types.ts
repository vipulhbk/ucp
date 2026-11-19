import { z } from "zod";

/**
 * The trip data contract. A trip planner (today the rule-based mock, later a model) must return a `Trip` that passes this
 * schema, so the UI and the booking flow never depend on how a trip was produced.
 *
 * Nothing here is a UCP type: the UCP release this project pins has no travel capability. Trips are content; only the
 * `bookables` touch the protocol, and they are ordinary merchant catalog variants (see docs/TRIPS.md).
 */

/** The eight interests offered by the planner form. Pick 1–3. */
export const INTERESTS = ["art", "kids", "sports", "shopping", "beaches", "nightlife", "romantic", "scenic"] as const;
export type Interest = (typeof INTERESTS)[number];

export const INTEREST_LABEL: Record<Interest, string> = {
  art: "Art & culture",
  kids: "Kids entertainment",
  sports: "Sports & adventure",
  shopping: "Shopping",
  beaches: "Beaches & water sports",
  nightlife: "Night life",
  romantic: "Romantic",
  scenic: "Scenic views",
};

/** Spend per day per person, mirroring a four-step $–$$$$ selector. Amounts are illustrative ranges in INR. */
export const BUDGET_TIERS = [1, 2, 3, 4] as const;
export type BudgetTier = (typeof BUDGET_TIERS)[number];
export const BUDGET_LABEL: Record<BudgetTier, { symbol: string; range: string }> = {
  1: { symbol: "₹", range: "under ₹3,000 a day" },
  2: { symbol: "₹₹", range: "₹3,000–7,000 a day" },
  3: { symbol: "₹₹₹", range: "₹7,000–15,000 a day" },
  4: { symbol: "₹₹₹₹", range: "₹15,000+ a day" },
};

export const SLOTS = ["morning", "afternoon", "evening"] as const;

export const ItineraryItemSchema = z.object({
  slot: z.enum(SLOTS),
  title: z.string().min(1),
  detail: z.string().min(1),
  /** Neighbourhood or area, for grouping on a map later. */
  area: z.string().min(1),
  /** Illustrative cost per person in whole rupees; 0 = free. */
  costInr: z.number().int().nonnegative(),
});

export const ItineraryDaySchema = z.object({
  day: z.number().int().positive(),
  title: z.string().min(1),
  items: z.array(ItineraryItemSchema).min(1),
});

/** A purchasable part of a trip. `variantId` is a merchant catalog variant, bought through UCP checkout. */
export const BookableSchema = z.object({
  variantId: z.string().regex(/^var_/),
  label: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const TripSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  destination: z.string().min(1),
  country: z.string().min(1),
  tagline: z.string().min(1),
  /** Lower-case words the mock planner matches the traveller's destination text against (city, country, nicknames). */
  aliases: z.array(z.string().min(1)).min(1),
  days: z.number().int().min(1).max(14),
  interests: z.array(z.enum(INTERESTS)).min(1).max(4),
  budgetTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  bestSeason: z.string().min(1),
  /** Cover art, a path under /public. */
  cover: z.string().startsWith("/trips/"),
  highlights: z.array(z.string().min(1)).min(2),
  itinerary: z.array(ItineraryDaySchema).min(1),
  tips: z.array(z.string().min(1)),
  bookables: z.array(BookableSchema).min(1),
});

export type ItineraryItem = z.infer<typeof ItineraryItemSchema>;
export type ItineraryDay = z.infer<typeof ItineraryDaySchema>;
export type Bookable = z.infer<typeof BookableSchema>;
export type Trip = z.infer<typeof TripSchema>;

/** What the traveller typed into the planner form. */
export const PlanRequestSchema = z.object({
  destination: z.string().max(80).default(""),
  interests: z.array(z.enum(INTERESTS)).max(3).default([]),
  budgetTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  notes: z.string().max(500).default(""),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

/**
 * An itinerary a model wrote for whatever the traveller asked, in any destination. It is *not* a `Trip`: it has no id, cover
 * or bookables, because a model cannot create merchant catalog items. Every field is length-capped here because a model's
 * output is untrusted input, and it is only ever rendered as plain text.
 */
const text = (max: number) => z.string().trim().min(1).max(max);
export const GeneratedItinerarySchema = z.object({
  title: text(100),
  destination: text(80),
  country: text(60),
  tagline: text(160),
  bestSeason: text(60),
  highlights: z.array(text(120)).min(2).max(6),
  itinerary: z
    .array(
      z.object({
        title: text(100),
        items: z
          .array(
            z.object({
              slot: z.enum(SLOTS),
              title: text(120),
              detail: text(300),
              area: text(80),
              costInr: z.number().min(0).max(500_000).transform((n) => Math.round(n)),
            }),
          )
          .min(1)
          .max(5),
      }),
    )
    .min(1)
    .max(7),
  tips: z.array(text(200)).min(1).max(6),
});
export type GeneratedItinerary = z.infer<typeof GeneratedItinerarySchema>;

export interface PlanResult {
  /**
   * The ready-made trip this result links to. For the mock planner it is the plan itself. For a model it is only the closest
   * trip that can actually be booked, because a generated itinerary has nothing in the merchant catalog.
   */
  trip: Trip;
  /** Present when a model wrote an itinerary of its own. Absent for the mock, whose plan is `trip`. */
  generated?: GeneratedItinerary;
  /** Why this trip was chosen, in plain words. The mock explains its rules; a model would explain its reasoning. */
  reasons: string[];
  /** Notes the planner could not honour (for example a destination it has no trip for). */
  caveats: string[];
  /** Who produced the plan. Shown in the UI so a demo plan is never mistaken for a model's output. */
  source: { kind: "mock"; name: string } | { kind: "model"; name: string };
}

/** The port a real model-backed planner will implement. */
export interface TripPlanner {
  plan(request: PlanRequest): Promise<PlanResult>;
}

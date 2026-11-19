import { bff, badRequest } from "@/app-services/bff";
import { planTrip } from "@/app-services/trip-planner";
import { PlanRequestSchema } from "@/trips/types";

/** Gemini can take several seconds; the default function limit on some plans is shorter. */
export const maxDuration = 30;

/**
 * Plan a trip from the form. With a Gemini key configured the plan is written by the model and falls back to the rule-based
 * mock if the model fails; the response's `source` always says which one produced it.
 */
export const POST = bff(async (req, ctx) => {
  const parsed = PlanRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "invalid plan request");
  return planTrip(ctx.sid, parsed.data);
});

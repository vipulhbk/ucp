import { bff, badRequest } from "@/app-services/bff";
import { tripPlanner } from "@/trips/planner";
import { PlanRequestSchema } from "@/trips/types";

/** Plan a trip from the form. Today the planner is the rule-based mock; the response says so in `source`. */
export const POST = bff(async (req) => {
  const parsed = PlanRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "invalid plan request");
  return tripPlanner.plan(parsed.data);
});

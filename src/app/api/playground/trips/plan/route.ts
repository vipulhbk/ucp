import { bff, badRequest } from "@/app-services/bff";
import { MockTripPlanner } from "@/trips/planner";
import { PlanRequestSchema } from "@/trips/types";

/** Plan a trip from the form. The planner is the rule-based one in `src/trips/planner.ts`; the response's `source` says so. */
export const POST = bff(async (req) => {
  const parsed = PlanRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "invalid plan request");
  return new MockTripPlanner().plan(parsed.data);
});

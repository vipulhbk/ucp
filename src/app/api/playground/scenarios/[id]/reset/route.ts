import { bff } from "@/app-services/bff";
import { resetScenario } from "@/app-services/scenarios/engine";

/** Resets the scenario by deleting this demo session's data on both sides (other visitors are unaffected). */
export async function POST(req: Request) {
  return bff(async (_r, ctx) => ({ ok: true, ...(await resetScenario(ctx)) }))(req);
}

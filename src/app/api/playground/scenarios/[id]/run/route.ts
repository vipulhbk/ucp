import { bff } from "@/app-services/bff";
import { runNext } from "@/app-services/scenarios/engine";

/** Run the next step of a scenario (or, after a buyer step, verify what the buyer did). */
export async function POST(req: Request, c: RouteContext<"/api/playground/scenarios/[id]/run">) {
  const { id } = await c.params;
  return bff(async (r, ctx) => {
    const out = await runNext(r, ctx, id);
    return "error" in out ? Response.json({ error: { kind: "bad_request", message: out.error } }, { status: 409 }) : out;
  })(req);
}

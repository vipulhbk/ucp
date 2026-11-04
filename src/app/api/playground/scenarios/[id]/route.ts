import { bff } from "@/app-services/bff";
import { getState } from "@/app-services/scenarios/engine";

export async function GET(req: Request, c: RouteContext<"/api/playground/scenarios/[id]">) {
  const { id } = await c.params;
  return bff(async (_r, ctx) => {
    const state = await getState(ctx, id);
    return state ? { state } : Response.json({ error: { kind: "not_found", message: "unknown scenario" } }, { status: 404 });
  })(req);
}

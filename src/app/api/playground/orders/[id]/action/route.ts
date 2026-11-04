import { z } from "zod";
import { bff, badRequest } from "@/app-services/bff";
import { orderAction } from "@/app-services/admin";
import { ADMIN_ACTIONS } from "@/merchant/orders/events";

const Body = z.object({ action: z.enum(ADMIN_ACTIONS as [string, ...string[]]) });

/** Merchant admin action (ship / deliver / cancel / return / refund). Not a UCP operation: it produces a webhook. */
export async function POST(req: Request, ctx: RouteContext<"/api/playground/orders/[id]/action">) {
  const { id } = await ctx.params;
  return bff(async (r, s) => {
    const parsed = Body.safeParse(await r.json().catch(() => null));
    if (!parsed.success) return badRequest(`action must be one of ${ADMIN_ACTIONS.join(", ")}`);
    const out = await orderAction(r, s.sid, id, parsed.data.action as never);
    if (!out.ok) return Response.json({ error: { kind: out.code, message: out.message } }, { status: out.code === "not_found" ? 404 : 409 });
    return out;
  })(req);
}

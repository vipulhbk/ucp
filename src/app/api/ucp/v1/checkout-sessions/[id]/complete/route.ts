import { ops } from "@/merchant/routes";

export async function POST(req: Request, ctx: RouteContext<"/api/ucp/v1/checkout-sessions/[id]/complete">) {
  return ops.completeCheckout(req, (await ctx.params).id);
}

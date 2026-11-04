import { ops } from "@/merchant/routes";

export async function POST(req: Request, ctx: RouteContext<"/api/ucp/v1/checkout-sessions/[id]/cancel">) {
  return ops.cancelCheckout(req, (await ctx.params).id);
}

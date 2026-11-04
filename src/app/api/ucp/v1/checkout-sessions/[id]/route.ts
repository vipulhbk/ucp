import { ops } from "@/merchant/routes";

export async function GET(req: Request, ctx: RouteContext<"/api/ucp/v1/checkout-sessions/[id]">) {
  return ops.getCheckout(req, (await ctx.params).id);
}
export async function PUT(req: Request, ctx: RouteContext<"/api/ucp/v1/checkout-sessions/[id]">) {
  return ops.updateCheckout(req, (await ctx.params).id);
}

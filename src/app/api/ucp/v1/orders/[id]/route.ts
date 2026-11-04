import { ops } from "@/merchant/routes";

export async function GET(req: Request, ctx: RouteContext<"/api/ucp/v1/orders/[id]">) {
  return ops.getOrder(req, (await ctx.params).id);
}

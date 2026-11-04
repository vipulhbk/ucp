import { CAP } from "@/ucp/constants";
import { errorBody } from "@/ucp/errors";
import type { MerchantCtx, ServiceResult } from "../checkout/types";
import { loadOrder, renderOrder } from "./orders";

export async function getOrder(ctx: MerchantCtx, id: string): Promise<ServiceResult> {
  // Orders are keyed by the originating platform: another platform's credential simply cannot see it
  // (spec: platform credentials → orders originated by the platform).
  const rec = await loadOrder(ctx.store, ctx.platformId, id);
  if (!rec) {
    return { status: 404, body: errorBody("not_found", "Order not found.", { capabilities: { [CAP.order]: [{ version: ctx.active[CAP.order]?.version ?? "" }] } }) };
  }
  return { status: 200, body: renderOrder(rec, ctx) };
}

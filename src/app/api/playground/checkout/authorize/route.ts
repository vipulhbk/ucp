import { z } from "zod";
import { bff, badRequest } from "@/app-services/bff";
import { authorizeAndComplete } from "@/app-services/checkout-flow";
import { getPlatform } from "@/app-services/platform-session";

const Body = z.object({ checkoutId: z.string().min(1), cardId: z.string().min(1), expectedTotal: z.number().int().nonnegative(), idempotencyKey: z.string().uuid().optional() });

/** One buyer click on the confirmation card: authorize the shown total, then complete. Never callable by the agent. */
export const POST = bff(async (req, ctx) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("checkoutId, cardId and expectedTotal (the amount shown to the buyer) are required");
  return authorizeAndComplete(await getPlatform(req, ctx), parsed.data);
});

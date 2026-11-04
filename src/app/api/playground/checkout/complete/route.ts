import { z } from "zod";
import { bff, badRequest } from "@/app-services/bff";
import { completeWithConsent } from "@/app-services/checkout-flow";
import { getPlatform } from "@/app-services/platform-session";

const Body = z.object({ checkoutId: z.string().min(1), cardId: z.string().min(1), idempotencyKey: z.string().uuid().optional() });

/** Complete Checkout, gated by buyer consent (see checkout-flow.ts). */
export const POST = bff(async (req, ctx) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("checkoutId and cardId are required");
  return completeWithConsent(await getPlatform(req, ctx), parsed.data);
});

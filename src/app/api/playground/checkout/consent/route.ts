import { z } from "zod";
import { bff, badRequest } from "@/app-services/bff";
import { grantBuyerConsent } from "@/app-services/checkout-flow";
import { getPlatform } from "@/app-services/platform-session";

const Body = z.object({ checkoutId: z.string().min(1), cardId: z.string().min(1), expectedTotal: z.number().int().nonnegative() });

/**
 * THE buyer-authorization endpoint, called only by the confirmation UI when the buyer clicks "Authorize".
 * `expectedTotal` is what the buyer was shown; the server refuses if the live total differs. Consent is single-use and
 * expires in 10 minutes. The shopping agent has no route to this endpoint.
 */
export const POST = bff(async (req, ctx) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("checkoutId, cardId and expectedTotal (the amount shown to the buyer) are required");
  return grantBuyerConsent(await getPlatform(req, ctx), parsed.data);
});

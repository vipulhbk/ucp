import { z } from "zod";
import { bff, badRequest } from "@/app-services/bff";
import { FlowError } from "@/app-services/checkout-flow";
import { getPlatform } from "@/app-services/platform-session";
import { tripById } from "@/trips/samples";

const Body = z.object({ tripId: z.string().min(1), email: z.string().email().max(120), firstName: z.string().min(1).max(60) });

/**
 * Turn a trip into a UCP checkout: Create Checkout with the trip's bookable catalog variants, then Update (a full
 * replacement) with the traveller's details. The merchant prices everything and, because the items are digital vouchers,
 * collects no shipping. Paying is a separate buyer click on /checkout/authorize; this route never completes anything.
 */
export const POST = bff(async (req, ctx) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("tripId, a valid email and a first name are required");
  const { tripId, email, firstName } = parsed.data;
  const trip = tripById(tripId);
  if (!trip) return badRequest(`unknown trip ${tripId}`);

  const session = await getPlatform(req, ctx);
  if (!session.client) throw new FlowError("discovery_failed", session.report.error?.message ?? "discovery has not succeeded", 409);

  const created = await session.client.createCheckout({ line_items: trip.bookables.map((b) => ({ item: { id: b.variantId }, quantity: b.quantity })) });
  const co = created.body as { id?: string; line_items?: { id: string; item: { id: string }; quantity: number }[] };
  if (!co?.id || !co.line_items) throw new FlowError("checkout_refused", "The business did not create a checkout for this trip.", 409, { exchange: created.exchange, body: created.body });

  const updated = await session.client.updateCheckout(co.id, {
    line_items: co.line_items.map((l) => ({ id: l.id, item: { id: l.item.id }, quantity: l.quantity })),
    buyer: { email, first_name: firstName },
  });
  return { tripId, checkout: updated.body, exchanges: [{ label: "Create checkout", ex: created.exchange }, { label: "Update checkout (traveller details, full replacement)", ex: updated.exchange }] };
});

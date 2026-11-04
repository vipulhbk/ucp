import { z } from "zod";
import { bff, badRequest } from "@/app-services/bff";
import { sendExtraDelivery } from "@/app-services/admin";
import { ATTACK_KINDS } from "@/merchant/webhooks/outbox";

const Body = z.object({ rowId: z.string().min(1), mode: z.enum(["redeliver", ...ATTACK_KINDS] as [string, ...string[]]) });

/**
 * `redeliver` re-sends a stored event with the SAME Webhook-Id (a duplicate; the platform must not apply it twice).
 * The other modes are SECURITY DEMONSTRATIONS where the business plays an attacker, to show each platform check rejecting it.
 */
export const POST = bff(async (req, ctx) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("rowId and a valid mode are required");
  const r = await sendExtraDelivery(req, ctx.sid, parsed.data.rowId, parsed.data.mode as never);
  if (!r) return Response.json({ error: { kind: "not_found", message: "no such outbox row" } }, { status: 404 });
  return { attempt: r.attempt };
});

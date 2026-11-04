import { z } from "zod";
import { bff, badRequest } from "@/app-services/bff";
import { authorizationAttempted, publicRun, sendMessage } from "@/app-services/agent-service";

const Body = z.union([z.object({ text: z.string().min(1).max(500) }), z.object({ event: z.literal("authorization_attempted"), cardId: z.string().optional() })]);

/**
 * Talk to the agent, or tell it the buyer pressed Authorize. The event carries no result: the agent re-reads the
 * checkout from the merchant, so a forged event cannot make it believe an order exists.
 */
export const POST = bff(async (req, ctx) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("send {text} (max 500 chars) or {event:'authorization_attempted'}");
  const run = "text" in parsed.data ? await sendMessage(req, ctx, parsed.data.text) : await authorizationAttempted(req, ctx, parsed.data.cardId);
  return { run: publicRun(run) };
});

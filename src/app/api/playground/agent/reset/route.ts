import { bff } from "@/app-services/bff";
import { resetSession } from "@/app-services/platform-session";

/** Start over completely: clears the agent run and everything the session created (same as Reset session). */
export const POST = bff(async (_req, ctx) => ({ ok: true, ...(await resetSession(ctx.sid)) }));

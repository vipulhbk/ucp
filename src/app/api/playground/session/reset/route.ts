import { bff } from "@/app-services/bff";
import { resetSession } from "@/app-services/platform-session";

/** Deletes everything this demo session created, on both the platform and the business side. */
export const POST = bff(async (_req, ctx) => ({ ok: true, ...(await resetSession(ctx.sid)) }));

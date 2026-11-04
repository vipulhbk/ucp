import { bff } from "@/app-services/bff";
import { retryNow } from "@/app-services/admin";

/** "Retry now": deliver pending rows immediately, ignoring the backoff schedule. */
export const POST = bff(async (req, ctx) => retryNow(req, ctx.sid, true));

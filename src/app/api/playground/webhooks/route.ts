import { bff } from "@/app-services/bff";
import { webhookState } from "@/app-services/admin";

/** Both ends of the webhook channel for this session: the business outbox and the platform's receipts + order snapshots. */
export const GET = bff(async (req, ctx) => webhookState(req, ctx.sid));

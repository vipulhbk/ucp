import { timingSafeEqual } from "node:crypto";
import { resolveOrigin } from "@/config";
import { outboxDeps } from "@/merchant/webhooks/deps";
import { flushAllDue } from "@/merchant/webhooks/outbox";

/**
 * Retry driver for pending webhooks across all platforms. Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
 * Disabled (404) unless CRON_SECRET is set. (Hobby-plan crons run at most daily; "Retry now" and delivery-on-activity cover the demo.)
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("Not found", { status: 404 });
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return new Response("Unauthorized", { status: 401 });
  return Response.json({ attempted: await flushAllDue(outboxDeps(resolveOrigin(req))) });
}

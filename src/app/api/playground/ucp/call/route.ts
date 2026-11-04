import { z } from "zod";
import { bff, badRequest } from "@/app-services/bff";
import { getPlatform } from "@/app-services/platform-session";
import { OPERATIONS, type OperationName } from "@/platform/ucp-client";

const names = Object.keys(OPERATIONS).filter((o) => o !== "complete_checkout") as [string, ...string[]];
const Body = z.object({
  op: z.enum(names),
  id: z.string().optional(),
  body: z.unknown().optional(),
  /** Playground only: send the request body unvalidated to see the business's own validation errors. */
  skipValidation: z.boolean().optional(),
  /** Reuse a key to demonstrate idempotent replay of an identical request. */
  idempotencyKey: z.string().uuid().optional(),
});

/**
 * Playground → platform UCP client → business, over real HTTP. Complete Checkout is deliberately NOT callable here:
 * it is only reachable through /checkout/complete, which requires the buyer's explicit consent.
 */
export const POST = bff(async (req, ctx) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "invalid body");
  const { op, id, body, skipValidation, idempotencyKey } = parsed.data;
  const session = await getPlatform(req, ctx);
  if (!session.client) return Response.json({ error: { kind: "discovery_failed", message: session.report.error?.message ?? "discovery did not succeed", report: session.report } }, { status: 409 });
  const needsId = ["get_checkout", "update_checkout", "cancel_checkout", "get_order"].includes(op);
  if (needsId && !id) return badRequest(`${op} requires id`);
  const r = await session.client.call(op as OperationName, { id, body }, { skipRequestValidation: skipValidation, idempotencyKey });
  return { status: r.status, body: r.body, headers: r.headers, requestId: r.requestId, idempotencyKey: r.idempotencyKey, durationMs: r.durationMs, validation: r.validation, exchange: r.exchange, attempts: r.attempts };
});

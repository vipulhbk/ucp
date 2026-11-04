import { z } from "zod";
import { bff, badRequest } from "@/app-services/bff";
import { getPlatform } from "@/app-services/platform-session";
import { tokenizeViaHandler } from "@/platform/tokenize";
import { CAP } from "@/ucp/constants";

const Body = z.object({
  cardId: z.string().optional(),
  /** Typed into the simulator to demonstrate that real card numbers are refused. Never stored or logged. */
  number: z.string().max(32).optional(),
  checkoutId: z.string().default("chk_simulator"),
});

/** Payment Simulator: run only the tokenize step against the advertised handler and show the exchange. */
export const POST = bff(async (req, ctx) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (!parsed.data.cardId && !parsed.data.number)) return badRequest("cardId or number is required");
  const session = await getPlatform(req, ctx);
  const handlers = session.report.profile?.ucp.payment_handlers ?? {};
  const entry = Object.values(handlers).flat()[0] as { id: string; config?: { tokenize_url?: string } } | undefined;
  const tokenizeUrl = entry?.config?.tokenize_url;
  if (!tokenizeUrl) return Response.json({ error: { kind: "no_payment_handler", message: "Run discovery first; the profile advertises no payment handler" } }, { status: 409 });
  const r = await tokenizeViaHandler({
    sid: ctx.sid,
    recorder: session.recorder,
    tokenizeUrl,
    apiKey: session.apiKey,
    fetchOptions: session.fetchOptions,
    card: parsed.data.cardId ? { id: parsed.data.cardId } : { number: parsed.data.number! },
    binding: { type: CAP.checkout, id: parsed.data.checkoutId },
  });
  return { status: r.status, body: r.token ? { ...(r.body as object), token: "[REDACTED]" } : r.body, exchange: r.exchange };
});

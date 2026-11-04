import { z } from "zod";
import { bff, badRequest } from "@/app-services/bff";
import { replay } from "@/app-services/inspector";

const Body = z.object({ id: z.string().min(1).max(64) });

/** Re-issue a recorded READ-ONLY platform request and compare. State-changing calls are refused (see SAFE_REPLAY_OPS). */
export const POST = bff(async (req, ctx) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("id is required");
  const r = await replay(req, ctx, parsed.data.id);
  return r.ok ? r : Response.json({ error: { kind: r.kind, message: r.message } }, { status: r.status });
});

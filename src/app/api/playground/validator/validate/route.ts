import { z } from "zod";
import { bff, badRequest } from "@/app-services/bff";
import { MAX_PAYLOAD_BYTES, validateText } from "@/app-services/validator/validate";

const Body = z.object({ target: z.string().min(1).max(64), payload: z.string().max(MAX_PAYLOAD_BYTES + 1024) });

/** Validate a JSON payload (as text, so syntax errors are reported too) against one of the official schemas. */
export const POST = bff(async (req) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("target and payload (JSON text) are required");
  const report = validateText(parsed.data.target, parsed.data.payload);
  return report ?? Response.json({ error: { kind: "unknown_target", message: `No validation target "${parsed.data.target}"` } }, { status: 404 });
});

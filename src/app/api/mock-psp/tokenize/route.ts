import { z } from "zod";
import { getConfig } from "@/config";
import { getStore } from "@/persistence";
import { verifyApiKey } from "@/ucp/platform-credential";
import { tokenize } from "@/sim/psp";

const Body = z.object({
  credential: z.object({ type: z.string() }).passthrough(),
  binding: z.object({ type: z.string(), id: z.string() }),
  identity: z.object({ access_token: z.string() }).optional(),
});

/**
 * SIMULATED tokenizer, `POST /tokenize` (request/response shapes per source/handlers/tokenization/openapi.json).
 * Not a UCP endpoint of the business: it is the credential provider's API. Authenticated with the platform credential.
 */
export async function POST(req: Request) {
  const platformId = verifyApiKey(getConfig().serverSecret, req.headers.get("x-api-key"));
  if (!platformId) return Response.json({ error: "unauthorized", message: "X-API-Key platform credential required" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request", message: "credential and binding are required" }, { status: 400 });
  const r = await tokenize(getStore(), platformId, parsed.data);
  if (!r.ok) return Response.json({ error: r.code, message: r.message, simulated: true }, { status: r.status });
  return Response.json({ token: r.token, expires_at: r.expiresAt, display: r.display, simulated: true });
}

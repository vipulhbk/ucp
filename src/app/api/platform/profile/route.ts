import { resolveOrigin } from "@/config";
import { isPlatformVariant, platformProfileFor } from "@/platform/profile-variants";

/** Platform profile advertised in `UCP-Agent` (spec: overview → Platform Profile). `?variant=` selects a labelled fixture. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const v = q.get("variant");
  const profile = platformProfileFor(resolveOrigin(req), isPlatformVariant(v) ? v : "default", process.env.UCP_NAMESPACE ? `${process.env.UCP_NAMESPACE}.mock_tokenizer` : undefined, q.get("p"));
  return Response.json(profile, { headers: { "Cache-Control": "no-store" } });
}

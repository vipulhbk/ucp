import { targetById } from "@/app-services/validator/targets";

/** The official source schema document (unmodified) that corresponds to a target: the "expected schema". */
export async function GET(_req: Request, ctx: RouteContext<"/api/playground/validator/schema/[id]">) {
  const t = targetById((await ctx.params).id);
  if (!t) return Response.json({ error: { kind: "not_found", message: "unknown target" } }, { status: 404 });
  return Response.json({ file: t.docFile, url: t.docUrl, note: "Official source schema, unresolved: ucp_request/ucp_response annotations are still present. Validation uses the Zod schema generated from it.", schema: t.doc });
}

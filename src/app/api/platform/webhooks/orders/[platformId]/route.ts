import { getConfig } from "@/config";
import { defer } from "@/lib/defer";
import { getStore } from "@/persistence";
import { demoOrigins } from "@/platform/origins";
import { receiveOrderWebhook } from "@/platform/webhook-handler";
import { resolveOrigin } from "@/config";

/** Platform's order webhook receiver (the URL the platform advertises in its `dev.ucp.shopping.order` config). */
export async function POST(req: Request, ctx: RouteContext<"/api/platform/webhooks/orders/[platformId]">) {
  const { platformId } = await ctx.params;
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k] = v));
  const cfg = getConfig();
  const r = await receiveOrderWebhook(
    { store: getStore(), fetchOptions: { allowedOrigins: demoOrigins(resolveOrigin(req)), devLoopbackHosts: cfg.devLoopbackHosts }, now: Date.now },
    platformId,
    { method: req.method, url: req.url, headers, body: Buffer.from(await req.arrayBuffer()) },
  );
  if (r.process) defer(r.process);
  return Response.json(r.body, { status: r.status });
}

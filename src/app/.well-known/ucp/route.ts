import { businessProfileFor } from "@/merchant/profile";

/** GET /.well-known/ucp — UCP business discovery profile (spec: overview → Profile Structure). */
export async function GET(req: Request) {
  const profile = businessProfileFor(req);
  return Response.json(profile, {
    headers: { "Cache-Control": process.env.NODE_ENV === "production" ? "public, max-age=300" : "no-store" },
  });
}

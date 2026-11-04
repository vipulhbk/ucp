import { z } from "zod";
import { resolveOrigin } from "@/config";
import { bff, badRequest } from "@/app-services/bff";
import { runDiscovery } from "@/app-services/platform-session";
import { demoOrigins } from "@/platform/origins";
import { PLATFORM_VARIANTS, type PlatformVariant } from "@/platform/profile-variants";

const variants = Object.keys(PLATFORM_VARIANTS) as [PlatformVariant, ...PlatformVariant[]];
const Body = z.object({
  origin: z.string().url().optional(),
  /** Platform fixture used to demonstrate negotiation outcomes (all are labelled fixtures in the UI). */
  variant: z.enum(variants).default("default"),
});

/** BFF: run platform-side discovery against an allowlisted demo merchant origin; the result becomes the session's platform. */
export const POST = bff(async (req, ctx) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest("invalid body");
  const self = resolveOrigin(req);
  const allowed = demoOrigins(self);
  const origin = (parsed.data.origin ?? self).replace(/\/$/, "");
  if (!allowed.includes(origin)) {
    return Response.json({ error: "origin_not_allowlisted", message: `Only these demo origins can be fetched: ${allowed.join(", ")}` }, { status: 400 });
  }
  const session = await runDiscovery(req, ctx, parsed.data.variant, origin);
  return session.report;
});

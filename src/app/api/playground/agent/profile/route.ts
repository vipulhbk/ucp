import { z } from "zod";
import { bff, badRequest } from "@/app-services/bff";
import { publicRun, setProfile } from "@/app-services/agent-service";

const s = z.string().trim().min(1).max(120);
const Body = z.object({ email: z.string().trim().email().max(120), first_name: s, last_name: s, street_address: s, address_locality: s, address_region: s, postal_code: s, address_country: z.string().trim().length(2) });

/** Buyer profile the agent uses to fill buyer and shipping details. Synthetic by default; never enter real personal data. */
export const POST = bff(async (req, ctx) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "invalid profile");
  return { run: publicRun(await setProfile(ctx, { ...parsed.data, address_country: parsed.data.address_country.toUpperCase() })) };
});

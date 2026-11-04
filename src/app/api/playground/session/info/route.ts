import { bff } from "@/app-services/bff";
import { getPlatform } from "@/app-services/platform-session";

/** Current platform for this session (runs the compatible-platform discovery if none yet). */
export const GET = bff(async (req, ctx) => {
  const s = await getPlatform(req, ctx);
  return {
    variant: s.variant,
    ok: s.report.ok,
    error: s.report.error,
    endpoint: s.report.rest?.endpoint,
    active: s.report.negotiation ? Object.keys(s.report.negotiation.active) : [],
    excluded: s.report.negotiation?.excluded ?? [],
    paymentHandlers: s.report.paymentHandlers,
  };
});

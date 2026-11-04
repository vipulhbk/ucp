import { bff } from "@/app-services/bff";
import { filterEvents, filterFromQuery, toNdjson } from "@/app-services/inspector";
import { mergedLog } from "@/app-services/platform-session";

/** Download the session log as NDJSON (redacted, no session id). Honors the same filters as the timeline. */
export const GET = bff(async (req, ctx) => {
  const events = filterEvents(await mergedLog(ctx.sid), filterFromQuery(new URL(req.url).searchParams));
  return new Response(toNdjson(events), { headers: { "content-type": "application/x-ndjson; charset=utf-8", "content-disposition": 'attachment; filename="ucp-session-log.ndjson"', "cache-control": "no-store" } });
});

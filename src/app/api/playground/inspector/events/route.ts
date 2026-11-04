import { bff } from "@/app-services/bff";
import { filterFromQuery, inspect } from "@/app-services/inspector";

/** Chronological platform + business interactions for this session (redacted at write time), with filters, facets and a summary. */
export const GET = bff(async (req, ctx) => inspect(ctx, filterFromQuery(new URL(req.url).searchParams)));

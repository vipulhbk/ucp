import { bff } from "@/app-services/bff";
import { listOrders } from "@/app-services/admin";

/** Merchant-side order dashboard data (business-internal; the platform-facing API is Get Order). */
export const GET = bff(async (req, ctx) => ({ orders: await listOrders(req, ctx.sid) }));

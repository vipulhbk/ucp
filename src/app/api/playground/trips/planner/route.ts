import { bff } from "@/app-services/bff";
import { plannerInfo } from "@/app-services/trip-planner";

/** Which planner is active, so the form can say, before anything is sent, whether the text goes to a third party. Never returns the key. */
export const GET = bff(async () => plannerInfo());

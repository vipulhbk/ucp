import { bff } from "@/app-services/bff";
import { getRun, publicRun } from "@/app-services/agent-service";

export const GET = bff(async (_req, ctx) => ({ run: publicRun(await getRun(ctx)) }));

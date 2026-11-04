import { bff } from "@/app-services/bff";
import { describeScenarios } from "@/app-services/scenarios/engine";

export const GET = bff(async () => ({ scenarios: describeScenarios() }));

import type { InteractionRecord } from "@/observability/recorder";
import type { Pending } from "@/platform/agent/types";
import type { Store } from "@/persistence/store";
import type { PlatformSession } from "../platform-session";
import type { SessionContext } from "../session";
import type { PlatformVariant } from "@/platform/profile-variants";

export interface StepResult {
  ok: boolean;
  summary: string;
  /** Real exchanges (redacted) that happened in this step. */
  exchanges: InteractionRecord[];
  /** Facts worth showing next to the exchanges (extracted from real responses, never invented). */
  facts?: { label: string; value: string }[];
  /** For buyer steps: the confirmation the UI must render. The scenario can never authorize for the buyer. */
  needsBuyer?: Extract<Pending, { type: "authorize" }> & { instruction: string };
}

export interface ScenarioStep {
  id: string;
  title: string;
  /** What the specification says happens at this step (the protocol sequence). */
  protocol: string;
  kind: "auto" | "buyer";
  /** auto: do the work. buyer: prepare the confirmation. */
  run: (env: Env) => Promise<StepResult>;
  /** buyer steps only: check what the buyer's click actually did (read from the merchant, never trusted). */
  verify?: (env: Env) => Promise<StepResult>;
}

export interface ScenarioDef {
  id: string;
  title: string;
  summary: string;
  specRefs: string[];
  steps: ScenarioStep[];
}

export interface ScenarioState {
  id: string;
  /** Index of the current step. */
  index: number;
  awaitingBuyer: boolean;
  results: (StepResult & { stepId: string; at: number })[];
  data: Record<string, string | number | undefined>;
  done: boolean;
}

export interface Env {
  req: Request;
  ctx: SessionContext;
  store: Store;
  data: ScenarioState["data"];
  session: () => Promise<PlatformSession>;
  /** Re-run discovery with a platform fixture; later steps use the resulting client. */
  discover: (variant: PlatformVariant) => Promise<PlatformSession>;
  /** All recorded exchanges (both sides) for a Request-Id. */
  exchangesFor: (correlationId: string) => Promise<InteractionRecord[]>;
}

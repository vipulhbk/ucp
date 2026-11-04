import "server-only";
import type { InteractionRecord } from "@/observability/recorder";
import { getStore } from "@/persistence";
import type { PlatformVariant } from "@/platform/profile-variants";
import { mergedLog, getPlatform, resetSession, runDiscovery } from "../platform-session";
import type { SessionContext } from "../session";
import { SCENARIOS, scenarioById } from "./definitions";
import type { Env, ScenarioState, StepResult } from "./types";

const stateKey = (sid: string, id: string) => `s:${sid}:scn:${id}`;
const fresh = (id: string): ScenarioState => ({ id, index: 0, awaitingBuyer: false, results: [], data: {}, done: false });

export function describeScenarios() {
  return SCENARIOS.map((s) => ({ id: s.id, title: s.title, summary: s.summary, specRefs: s.specRefs, steps: s.steps.map((x) => ({ id: x.id, title: x.title, protocol: x.protocol, kind: x.kind })) }));
}

export async function getState(ctx: SessionContext, id: string): Promise<ScenarioState | null> {
  if (!scenarioById(id)) return null;
  return (await getStore().get<ScenarioState>(stateKey(ctx.sid, id))) ?? fresh(id);
}

const envFor = (req: Request, ctx: SessionContext, state: ScenarioState): Env => ({
  req,
  ctx,
  store: getStore(),
  data: state.data,
  session: () => getPlatform(req, ctx),
  discover: (variant: PlatformVariant) => runDiscovery(req, ctx, variant),
  exchangesFor: async (correlationId: string): Promise<InteractionRecord[]> => {
    const log = await mergedLog(ctx.sid);
    return log.filter((l) => l.correlationId === correlationId);
  },
});

export type RunOutcome = { state: ScenarioState; result: StepResult; stepIndex: number } | { error: string };

/**
 * Execute the next step. Auto steps run immediately. A buyer step first PREPARES the confirmation and waits; the next call
 * VERIFIES what the buyer's click actually did by reading the merchant, so a scenario can never authorize for the buyer
 * and a forged "done" cannot advance it.
 */
export async function runNext(req: Request, ctx: SessionContext, id: string): Promise<RunOutcome> {
  const def = scenarioById(id);
  if (!def) return { error: "unknown scenario" };
  const store = getStore();
  const state = (await store.get<ScenarioState>(stateKey(ctx.sid, id))) ?? fresh(id);
  if (state.done) return { error: "This scenario is complete. Reset it to run it again." };
  const step = def.steps[state.index]!;
  const env = envFor(req, ctx, state);

  let result: StepResult;
  try {
    if (step.kind === "buyer" && state.awaitingBuyer) result = await step.verify!(env);
    else result = await step.run(env);
  } catch (e) {
    result = { ok: false, summary: `Step failed: ${(e as Error).message}`, exchanges: [] };
  }

  if (step.kind === "buyer" && !state.awaitingBuyer) {
    state.awaitingBuyer = result.ok; // wait for the buyer
  } else if (result.ok) {
    state.results.push({ ...result, stepId: step.id, at: Date.now() });
    state.awaitingBuyer = false;
    state.index += 1;
    state.done = state.index >= def.steps.length;
  }
  await store.set(stateKey(ctx.sid, id), state, { ttlSec: 24 * 3600 });
  return { state, result, stepIndex: step.kind === "buyer" && !state.awaitingBuyer && result.ok ? state.index - 1 : state.index };
}

/** Reset: removes everything this demo session created (both sides) and the scenario's progress. */
export async function resetScenario(ctx: SessionContext): Promise<{ removed: number }> {
  return resetSession(ctx.sid);
}

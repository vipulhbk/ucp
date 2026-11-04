import "server-only";
import { getStore } from "@/persistence";
import { handleAuthorizationResult, handleUserMessage, loadRun, probeUnsupportedCapability, saveRun, type AgentDeps } from "@/platform/agent/agent";
import type { AgentRun, BuyerProfile } from "@/platform/agent/types";
import { getPlatform } from "./platform-session";
import type { SessionContext } from "./session";

export function agentDeps(req: Request, ctx: SessionContext): AgentDeps {
  return {
    sid: ctx.sid,
    store: getStore(),
    session: async () => {
      const s = await getPlatform(req, ctx);
      return { client: s.client, report: s.report };
    },
  };
}

/** Keep the browser payload small and free of internals: the run IS the UI state. */
export const publicRun = (run: AgentRun) => ({ ...run, timeline: run.timeline.slice(-80), transcript: run.transcript.slice(-60) });

export async function getRun(ctx: SessionContext): Promise<AgentRun> {
  return loadRun(getStore(), ctx.sid);
}

export async function sendMessage(req: Request, ctx: SessionContext, text: string): Promise<AgentRun> {
  const deps = agentDeps(req, ctx);
  const run = await loadRun(deps.store, ctx.sid);
  await handleUserMessage(deps, run, text);
  await saveRun(deps.store, ctx.sid, run);
  return run;
}

export async function authorizationAttempted(req: Request, ctx: SessionContext, cardId?: string): Promise<AgentRun> {
  const deps = agentDeps(req, ctx);
  const run = await loadRun(deps.store, ctx.sid);
  await handleAuthorizationResult(deps, run, cardId);
  await saveRun(deps.store, ctx.sid, run);
  return run;
}

export async function setProfile(ctx: SessionContext, profile: BuyerProfile): Promise<AgentRun> {
  const store = getStore();
  const run = await loadRun(store, ctx.sid);
  run.profile = profile;
  await saveRun(store, ctx.sid, run);
  return run;
}

export async function probeCapability(req: Request, ctx: SessionContext) {
  const deps = agentDeps(req, ctx);
  const run = await loadRun(deps.store, ctx.sid);
  const r = await probeUnsupportedCapability(deps, run);
  await saveRun(deps.store, ctx.sid, run);
  return { run, response: r };
}

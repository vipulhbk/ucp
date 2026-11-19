import "server-only";
import { FallbackTripPlanner, GEMINI_DEFAULT_MODEL, GeminiTripPlanner, fallbackNote } from "@/trips/gemini";
import { MockTripPlanner } from "@/trips/planner";
import type { PlanRequest, PlanResult } from "@/trips/types";

/**
 * Chooses the trip planner from the environment (server side only, so the key is never sent to the browser):
 *   GEMINI_API_KEY   a Google AI Studio key. Present → plans are written by Gemini, with the mock as the fallback.
 *   GEMINI_MODEL     optional model id, default `gemini-3.5-flash-lite`.
 *   TRIP_PLANNER     `mock` forces the rule-based planner even when a key is set.
 *   GEMINI_PLANS_PER_HOUR   per-visitor allowance, default 10, to protect the free-tier quota.
 */
export type PlannerInfo = { mode: "mock" } | { mode: "gemini"; model: string };

export function plannerInfo(env: NodeJS.ProcessEnv = process.env): PlannerInfo {
  const key = env.GEMINI_API_KEY?.trim();
  if (!key || env.TRIP_PLANNER === "mock") return { mode: "mock" };
  return { mode: "gemini", model: env.GEMINI_MODEL?.trim() || GEMINI_DEFAULT_MODEL };
}

const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();

/**
 * Best-effort per-visitor limit. It lives in this server instance's memory, so on serverless hosting it is per instance and a
 * visitor who clears cookies gets a fresh allowance. It protects a free quota from casual overuse, not from a determined abuser.
 */
export function allowGeminiPlan(sid: string, now = Date.now(), max = Number(process.env.GEMINI_PLANS_PER_HOUR) || 10): boolean {
  const recent = (hits.get(sid) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= max) {
    hits.set(sid, recent);
    return false;
  }
  recent.push(now);
  hits.set(sid, recent);
  if (hits.size > 2000) for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  return true;
}

export async function planTrip(sid: string, request: PlanRequest): Promise<PlanResult> {
  const info = plannerInfo();
  const mock = new MockTripPlanner();
  if (info.mode === "mock") return mock.plan(request);
  if (!allowGeminiPlan(sid)) {
    const out = await mock.plan(request);
    return { ...out, caveats: [fallbackNote("limit"), ...out.caveats] };
  }
  return new FallbackTripPlanner(new GeminiTripPlanner({ apiKey: process.env.GEMINI_API_KEY!.trim(), model: info.model }), mock).plan(request);
}

import { createHash } from "node:crypto";
import { getConfig, resolveOrigin } from "@/config";
import { errorBody, httpStatusFor } from "@/ucp/errors";
import { businessSupportsVersion, intersectCapabilities, type CapabilityEntry, type CapabilityRegistry } from "@/ucp/negotiation";
import { safeFetch, SafeFetchError } from "@/ucp/safe-fetch";
import { ProfilePlatformSchema } from "@/ucp/schemas";
import { parseUcpAgent } from "@/ucp/ucp-agent";
import type { UcpProfile } from "@/ucp/profile";
import { demoOriginsFor } from "./origins";
import type { Store } from "@/persistence/store";

export type NegotiationOutcome =
  | { ok: true; platformProfileUrl: string; platformProfile: UcpProfile; active: Record<string, CapabilityEntry>; excluded: ReturnType<typeof intersectCapabilities>["excluded"] }
  | { ok: false; status: number; body: unknown };

const PROFILE_CACHE_TTL_SEC = 300;

/** Business-side request-time negotiation (spec: overview → Business Requirements, Request-Time Validation). */
export async function negotiateRequest(req: Request, store: Store, business: UcpProfile): Promise<NegotiationOutcome> {
  const origin = resolveOrigin(req);
  const fail = (code: string, content: string, status = httpStatusFor(code)): NegotiationOutcome => ({
    ok: false,
    status,
    body: errorBody(code, content, { version: business.ucp.version, continueUrl: `${origin}/` }),
  });

  const agent = parseUcpAgent(req.headers.get("ucp-agent"));
  if (!agent.ok) return fail("invalid_profile_url", agent.reason);

  const cfg = getConfig();
  const cacheKey = `cache:platform-profile:${createHash("sha256").update(agent.profile).digest("hex").slice(0, 32)}`;
  let platformProfile = await store.get<UcpProfile>(cacheKey);
  if (!platformProfile) {
    let res;
    try {
      res = await safeFetch(agent.profile, { allowedOrigins: demoOriginsFor(origin), devLoopbackHosts: cfg.devLoopbackHosts });
    } catch (e) {
      const err = e as SafeFetchError;
      // malformed/unsafe/not-allowed URL → 400; anything that failed while fetching → 424
      const urlProblem = ["invalid_url", "scheme_not_allowed", "userinfo_not_allowed", "not_allowlisted", "blocked_address"].includes(err.code);
      return urlProblem ? fail("invalid_profile_url", `Platform profile URL rejected: ${err.message}`) : fail("profile_unreachable", `Platform profile fetch failed: ${err.message}`);
    }
    if (res.status < 200 || res.status >= 300) return fail("profile_unreachable", `Platform profile fetch returned HTTP ${res.status}`);
    let json: unknown;
    try {
      json = JSON.parse(res.bodyText);
    } catch {
      return fail("profile_malformed", "Platform profile is not valid JSON");
    }
    const parsed = ProfilePlatformSchema.safeParse(json);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return fail("profile_malformed", `Platform profile violates the schema at ${first?.path.join(".") || "$"}: ${first?.message}`);
    }
    platformProfile = json as UcpProfile;
    await store.set(cacheKey, platformProfile, { ttlSec: PROFILE_CACHE_TTL_SEC });
  }

  if (!businessSupportsVersion({ version: business.ucp.version, supported_versions: business.ucp.supported_versions }, platformProfile.ucp.version)) {
    return fail("version_unsupported", `Version ${platformProfile.ucp.version} is not supported. This business implements version ${business.ucp.version}.`);
  }
  const { active, excluded } = intersectCapabilities((business.ucp.capabilities ?? {}) as CapabilityRegistry, (platformProfile.ucp.capabilities ?? {}) as CapabilityRegistry);
  return { ok: true, platformProfileUrl: agent.profile, platformProfile, active, excluded };
}

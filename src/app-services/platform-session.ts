import "server-only";
import { getConfig, resolveOrigin } from "@/config";
import { Recorder, type InteractionRecord } from "@/observability/recorder";
import { getStore } from "@/persistence";
import { discoverMerchant, type DiscoveryReport } from "@/platform/discovery";
import { demoOrigins } from "@/platform/origins";
import { isPlatformVariant, platformProfileFor, platformSupportedVersions, type PlatformVariant } from "@/platform/profile-variants";
import { UcpClient } from "@/platform/ucp-client";
import { recordOwnership } from "@/platform/orders";
import { issueApiKey, platformIdFor } from "@/ucp/platform-credential";
import type { UcpProfile } from "@/ucp/profile";
import type { SessionContext } from "./session";

const DISCOVERY_TTL_SEC = 300;

/** Platform profile URL for this session: the `p` parameter makes the advertised webhook URL specific to this platform. */
export function platformProfileUrl(self: string, variant: PlatformVariant, sid: string): string {
  const q = new URLSearchParams();
  if (variant !== "default") q.set("variant", variant);
  q.set("p", platformIdFor(sid));
  return `${self}/api/platform/profile?${q.toString()}`;
}
const discoveryKey = (sid: string) => `s:${sid}:discovery`;

export interface PlatformSession {
  sid: string;
  self: string;
  variant: PlatformVariant;
  report: DiscoveryReport;
  client?: UcpClient;
  apiKey: string;
  recorder: Recorder;
  fetchOptions: { allowedOrigins: string[]; devLoopbackHosts: string[] };
}

interface Stored {
  variant: PlatformVariant;
  report: DiscoveryReport;
}

export async function runDiscovery(req: Request, ctx: SessionContext, variant: PlatformVariant, originOverride?: string): Promise<PlatformSession> {
  const cfg = getConfig();
  const store = getStore();
  const self = resolveOrigin(req);
  const allowed = demoOrigins(self);
  const recorder = new Recorder(store);
  const origin = (originOverride ?? self).replace(/\/$/, "");
  const platformProfile = platformProfileFor(self, variant, process.env.UCP_NAMESPACE ? `${process.env.UCP_NAMESPACE}.mock_tokenizer` : undefined, platformIdFor(ctx.sid)) as UcpProfile;
  const report = await discoverMerchant({
    origin,
    platformProfile,
    platformProfileUrl: platformProfileUrl(self, variant, ctx.sid),
    platformSupportedVersions: platformSupportedVersions(variant),
    fetchOptions: { allowedOrigins: allowed, devLoopbackHosts: cfg.devLoopbackHosts },
    bindingOptions: { relaxedHosts: cfg.relaxedBindingHosts },
    recorder,
    sid: ctx.sid,
  });
  await store.set<Stored>(discoveryKey(ctx.sid), { variant, report }, { ttlSec: DISCOVERY_TTL_SEC });
  return build(ctx.sid, self, variant, report, recorder, allowed, cfg.devLoopbackHosts);
}

function build(sid: string, self: string, variant: PlatformVariant, report: DiscoveryReport, recorder: Recorder, allowed: string[], loop: string[]): PlatformSession {
  const cfg = getConfig();
  const apiKey = issueApiKey(cfg.serverSecret, platformIdFor(sid));
  const fetchOptions = { allowedOrigins: allowed, devLoopbackHosts: loop };
  const client =
    report.ok && report.rest
      ? new UcpClient({
          sid,
          endpoint: report.rest.endpoint,
          platformProfileUrl: platformProfileUrl(self, variant, sid),
          apiKey,
          onOrder: ({ orderId, checkoutId }) => recordOwnership(getStore(), platformIdFor(sid), { orderId, checkoutId, businessProfileUrl: report.profileUrl, placedAt: Date.now() }),
          recorder,
          fetchOptions,
          protectionBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
        })
      : undefined;
  return { sid, self, variant, report, client, apiKey, recorder, fetchOptions };
}

/** The session's platform: cached discovery (5 min), or a fresh run with the compatible platform. */
export async function getPlatform(req: Request, ctx: SessionContext): Promise<PlatformSession> {
  const store = getStore();
  const stored = await store.get<Stored>(discoveryKey(ctx.sid));
  if (stored && isPlatformVariant(stored.variant)) {
    const cfg = getConfig();
    const self = resolveOrigin(req);
    return build(ctx.sid, self, stored.variant, stored.report, new Recorder(store), demoOrigins(self), cfg.devLoopbackHosts);
  }
  return runDiscovery(req, ctx, "default");
}

export async function resetSession(sid: string): Promise<{ removed: number }> {
  const store = getStore();
  const a = await store.delPrefix(`s:${sid}:`);
  const b = await store.delPrefix(`m:${platformIdFor(sid)}:`);
  const c = await store.delPrefix(`p:${platformIdFor(sid)}:`);
  return { removed: a + b + c };
}

export async function mergedLog(sid: string): Promise<InteractionRecord[]> {
  const store = getStore();
  const platform = await new Recorder(store).list(sid);
  const pid = platformIdFor(sid);
  const business = await new Recorder(store, (id) => `m:${id}:log`).list(pid);
  const webhooksReceived = await new Recorder(store, (id) => `p:${id}:log`).list(pid); // platform side of webhook deliveries
  return [...platform, ...business, ...webhooksReceived].sort((a, b) => a.ts.localeCompare(b.ts));
}

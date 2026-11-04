import { randomUUID } from "node:crypto";
import { checkAuthorityBinding, type BindingOptions, type BindingResult } from "@/ucp/authority-binding";
import { UCP_VERSION, SERVICE_SHOPPING } from "@/ucp/constants";
import { intersectCapabilities, selectProtocolVersion, type CapabilityRegistry, type NegotiationResult, type VersionSelection } from "@/ucp/negotiation";
import type { UcpProfile } from "@/ucp/profile";
import { ProfileBusinessSchema } from "@/ucp/schemas";
import { safeFetch, SafeFetchError, type SafeFetchOptions } from "@/ucp/safe-fetch";
import { validateWith, type ValidationOutcome } from "@/ucp/validate";
import type { Recorder, ValidationEntry } from "@/observability/recorder";
import { serializeUcpAgent } from "@/ucp/ucp-agent";

export interface BindingRow {
  entity: "capability" | "service" | "payment_handler";
  name: string;
  schema: string;
  result: BindingResult;
}

export interface DiscoveryReport {
  ok: boolean;
  origin: string;
  profileUrl: string;
  correlationId: string;
  fetch?: { status: number; durationMs: number; resolvedIp: string };
  profile?: UcpProfile;
  profileValidation?: ValidationOutcome;
  versionSelection?: VersionSelection;
  bindings: BindingRow[];
  /** Entities removed before negotiation because authority binding failed (spec: MUST reject). */
  rejectedEntities: string[];
  rest?: { endpoint: string; schema?: string; version: string };
  negotiation?: NegotiationResult;
  paymentHandlers: { name: string; id: string; instruments: string[]; simulated: boolean }[];
  error?: { kind: string; message: string };
}

export interface DiscoverInput {
  origin: string;
  platformProfile: UcpProfile;
  platformProfileUrl: string;
  platformSupportedVersions?: readonly string[];
  fetchOptions: Pick<SafeFetchOptions, "allowedOrigins" | "devLoopbackHosts" | "resolve">;
  bindingOptions?: BindingOptions;
  recorder?: Recorder;
  sid?: string;
}

async function fetchProfileJson(url: string, input: DiscoverInput, correlationId: string, op: string) {
  const headers = { "ucp-agent": serializeUcpAgent(input.platformProfileUrl), "request-id": correlationId };
  const started = new Date().toISOString();
  try {
    const res = await safeFetch(url, { ...input.fetchOptions, headers });
    let body: unknown;
    try {
      body = JSON.parse(res.bodyText);
    } catch {
      body = undefined;
    }
    await input.recorder?.record({
      id: randomUUID(), sid: input.sid ?? "anon", correlationId, ts: started, actor: "platform", op, method: "GET", url,
      requestHeaders: headers, status: res.status, responseHeaders: res.headers, responseBody: body ?? res.bodyText.slice(0, 2000),
      durationMs: res.durationMs, validation: [], replayable: true,
    });
    return { res, body };
  } catch (e) {
    const err = e instanceof SafeFetchError ? e : new SafeFetchError("network", (e as Error).message);
    await input.recorder?.record({
      id: randomUUID(), sid: input.sid ?? "anon", correlationId, ts: started, actor: "platform", op, method: "GET", url,
      requestHeaders: headers, validation: [], error: { kind: err.code, message: err.message },
    });
    throw err;
  }
}

/** Platform-side discovery: fetch → validate → select version → authority-bind → negotiate. No hardcoded endpoints. */
export async function discoverMerchant(input: DiscoverInput): Promise<DiscoveryReport> {
  const correlationId = randomUUID();
  const profileUrl = `${input.origin.replace(/\/$/, "")}/.well-known/ucp`;
  const report: DiscoveryReport = { ok: false, origin: input.origin, profileUrl, correlationId, bindings: [], rejectedEntities: [], paymentHandlers: [] };

  try {
    const { res, body } = await fetchProfileJson(profileUrl, input, correlationId, "get_profile");
    report.fetch = { status: res.status, durationMs: res.durationMs, resolvedIp: res.resolvedIp };
    if (res.status !== 200 || body === undefined) {
      report.error = { kind: "profile_unreachable", message: `HTTP ${res.status} or non-JSON body from ${profileUrl}` };
      return report;
    }
    let validation = validateWith("ProfileBusinessSchema", ProfileBusinessSchema, body);
    report.profileValidation = validation;
    if (!validation.ok) {
      report.profile = body as UcpProfile;
      report.error = { kind: "profile_malformed", message: `profile failed schema validation (${validation.issues.length} issue(s))` };
      return report;
    }
    let profile = body as UcpProfile;

    const selection = selectProtocolVersion(
      { version: profile.ucp.version, supported_versions: profile.ucp.supported_versions },
      input.platformSupportedVersions ?? [input.platformProfile.ucp.version],
    );
    report.versionSelection = selection;
    if (selection.kind === "unsupported") {
      report.profile = profile;
      report.error = { kind: "version_unsupported", message: selection.reason };
      return report;
    }
    if (selection.kind === "legacy") {
      const leaf = await fetchProfileJson(selection.profileUri, input, correlationId, "get_profile_version");
      const leafBody = leaf.body as UcpProfile | undefined;
      // Spec: MUST verify the fetched profile's ucp.version equals the supported_versions key; leaf MUST NOT nest supported_versions.
      if (!leafBody || leafBody.ucp?.version !== selection.version || leafBody.ucp.supported_versions) {
        report.profile = profile;
        report.error = { kind: "profile_malformed", message: `leaf profile at ${selection.profileUri} does not declare version ${selection.version} (or nests supported_versions)` };
        return report;
      }
      validation = validateWith("ProfileBusinessSchema", ProfileBusinessSchema, leafBody);
      report.profileValidation = validation;
      profile = leafBody;
    }
    report.profile = profile;

    // Authority binding on every declared schema URL BEFORE it could be fetched; failures are rejected, not activated.
    const registry: CapabilityRegistry = {};
    for (const [name, entries] of Object.entries(profile.ucp.capabilities ?? {})) {
      const kept = entries.filter((e) => {
        if (!e.schema) return false; // a capability MUST declare a schema
        const result = checkAuthorityBinding(name, e.schema, input.bindingOptions);
        report.bindings.push({ entity: "capability", name, schema: e.schema, result });
        if (result.status === "invalid") report.rejectedEntities.push(name);
        return result.status !== "invalid";
      });
      if (kept.length) registry[name] = kept;
    }
    for (const [name, entries] of Object.entries(profile.ucp.services)) {
      for (const e of entries) {
        if (!e.schema) continue;
        report.bindings.push({ entity: "service", name, schema: e.schema, result: checkAuthorityBinding(name, e.schema, input.bindingOptions) });
      }
    }
    for (const [name, entries] of Object.entries(profile.ucp.payment_handlers)) {
      for (const e of entries) {
        const result = checkAuthorityBinding(name, e.schema, input.bindingOptions);
        report.bindings.push({ entity: "payment_handler", name, schema: e.schema, result });
        if (result.status !== "invalid") {
          report.paymentHandlers.push({ name, id: e.id, instruments: (e.available_instruments ?? []).map((i) => i.type), simulated: e.config?.simulated === true });
        } else report.rejectedEntities.push(name);
      }
    }

    const shopping = profile.ucp.services[SERVICE_SHOPPING]?.find((s) => s.transport === "rest");
    if (shopping?.endpoint) report.rest = { endpoint: shopping.endpoint, schema: shopping.schema, version: shopping.version };

    report.negotiation = intersectCapabilities(registry, input.platformProfile.ucp.capabilities ?? {});
    report.ok = Boolean(report.rest);
    if (!report.rest) report.error = { kind: "no_rest_endpoint", message: `profile has no ${SERVICE_SHOPPING} service with transport "rest"` };
    return report;
  } catch (e) {
    const err = e as SafeFetchError;
    report.error = { kind: err.code ?? "error", message: err.message };
    return report;
  }
}

export const PINNED_VERSION = UCP_VERSION;
export type { ValidationEntry };

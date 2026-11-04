/**
 * Protocol version selection and capability negotiation.
 * Spec: overview → Versioning → Protocol Version; Negotiation Protocol → Intersection Algorithm.
 * Compatibility is exact version equality, never inferred from date order.
 */
export interface CapabilityEntry {
  version: string;
  spec?: string;
  schema?: string;
  extends?: string | string[];
  config?: Record<string, unknown>;
}
export type CapabilityRegistry = Record<string, CapabilityEntry[]>;

export interface ProfileVersionInfo {
  version: string;
  supported_versions?: Record<string, string>;
}

export type VersionSelection =
  | { kind: "current"; version: string }
  | { kind: "legacy"; version: string; profileUri: string }
  | { kind: "unsupported"; reason: string };

/** Platform side: pick the most recent protocol version both parties support. */
export function selectProtocolVersion(business: ProfileVersionInfo, platformSupported: readonly string[]): VersionSelection {
  const offered = new Map<string, string | null>([[business.version, null]]);
  for (const [v, uri] of Object.entries(business.supported_versions ?? {})) offered.set(v, uri);
  const mutual = [...offered.keys()].filter((v) => platformSupported.includes(v)).sort();
  if (mutual.length === 0) {
    return {
      kind: "unsupported",
      reason: `business offers [${[...offered.keys()].join(", ")}]; platform supports [${platformSupported.join(", ")}]`,
    };
  }
  const best = mutual[mutual.length - 1]!;
  const uri = offered.get(best);
  return uri ? { kind: "legacy", version: best, profileUri: uri } : { kind: "current", version: best };
}

/** Business side request-time check: platform's declared version must be `version` or a `supported_versions` key. */
export function businessSupportsVersion(business: ProfileVersionInfo, platformVersion: string): boolean {
  return platformVersion === business.version || Object.hasOwn(business.supported_versions ?? {}, platformVersion);
}

export type ExclusionReason = "not_advertised_by_platform" | "no_mutual_version" | "orphaned_extension";

export interface NegotiationStep {
  step: 1 | 2 | 3 | 4;
  detail: string;
}

export interface NegotiationResult {
  active: Record<string, CapabilityEntry>;
  excluded: { name: string; reason: ExclusionReason; detail: string }[];
  trace: NegotiationStep[];
}

function parentsOf(entry: CapabilityEntry): string[] {
  if (!entry.extends) return [];
  return Array.isArray(entry.extends) ? entry.extends : [entry.extends];
}

export function intersectCapabilities(business: CapabilityRegistry, platform: CapabilityRegistry): NegotiationResult {
  const trace: NegotiationStep[] = [];
  const excluded: NegotiationResult["excluded"] = [];
  const active: Record<string, CapabilityEntry> = {};

  // Steps 1+2: same name, then highest version present in BOTH arrays.
  for (const [name, bizEntries] of Object.entries(business)) {
    const platEntries = platform[name];
    if (!platEntries?.length) {
      excluded.push({ name, reason: "not_advertised_by_platform", detail: "platform does not advertise this capability" });
      trace.push({ step: 1, detail: `${name}: platform does not advertise it → excluded` });
      continue;
    }
    const platVersions = new Set(platEntries.map((e) => e.version));
    const shared = bizEntries.filter((e) => platVersions.has(e.version)).sort((a, b) => a.version.localeCompare(b.version));
    if (shared.length === 0) {
      excluded.push({
        name,
        reason: "no_mutual_version",
        detail: `business [${bizEntries.map((e) => e.version).join(", ")}] vs platform [${[...platVersions].join(", ")}]`,
      });
      trace.push({ step: 2, detail: `${name}: no mutual version → excluded` });
      continue;
    }
    const chosen = shared[shared.length - 1]!;
    active[name] = chosen;
    trace.push({ step: 2, detail: `${name}: mutual version ${chosen.version} selected` });
  }

  // Steps 3+4: prune orphaned extensions until fixpoint.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, entry] of Object.entries(active)) {
      const parents = parentsOf(entry);
      if (parents.length > 0 && !parents.some((p) => p in active)) {
        delete active[name];
        excluded.push({ name, reason: "orphaned_extension", detail: `none of its parents [${parents.join(", ")}] are active` });
        trace.push({ step: 3, detail: `${name}: parents [${parents.join(", ")}] not active → pruned` });
        changed = true;
      }
    }
    if (changed) trace.push({ step: 4, detail: "repeat pruning until no more capabilities are removed" });
  }
  return { active, excluded, trace };
}

export type OperationFamily = "checkout" | "order" | "catalog.search" | "catalog.lookup";

/**
 * Response Capability Selection: only active capabilities relevant to the operation are echoed —
 * the root capability for the operation plus active extensions that extend it.
 */
export function relevantCapabilities(family: OperationFamily, active: Record<string, CapabilityEntry>): Record<string, { version: string }[]> {
  const root = {
    checkout: "dev.ucp.shopping.checkout",
    order: "dev.ucp.shopping.order",
    "catalog.search": "dev.ucp.shopping.catalog.search",
    "catalog.lookup": "dev.ucp.shopping.catalog.lookup",
  }[family];
  const out: Record<string, { version: string }[]> = {};
  for (const [name, entry] of Object.entries(active)) {
    if (name === root || parentsOf(entry).includes(root)) out[name] = [{ version: entry.version }];
  }
  return out;
}

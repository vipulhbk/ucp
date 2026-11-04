import { CAP, OFFICIAL_CAPABILITY_REFS, SERVICE_SHOPPING, SHOPPING_REST_SERVICE, UCP_VERSION } from "./constants";
import type { CapabilityRegistry } from "./negotiation";
import type { PublicJwk } from "./keys";

export interface ServiceEntry {
  version: string;
  spec: string;
  transport: "rest" | "mcp" | "a2a" | "embedded";
  endpoint?: string;
  schema?: string;
}

export interface PaymentHandlerEntry {
  id: string;
  version: string;
  spec: string;
  schema: string;
  available_instruments?: { type: string; constraints?: unknown }[];
  config?: Record<string, unknown>;
}

export interface UcpProfile {
  ucp: {
    version: string;
    supported_versions?: Record<string, string>;
    services: Record<string, ServiceEntry[]>;
    capabilities?: CapabilityRegistry;
    payment_handlers: Record<string, PaymentHandlerEntry[]>;
  };
  keys?: PublicJwk[];
}

/** Handler name = reversed host + `.mock_tokenizer` so it binds to the origin that serves its schema. */
export function mockHandlerName(origin: string, override?: string): string {
  if (override) return override;
  const host = new URL(origin).hostname;
  return `${host.split(".").reverse().join(".")}.mock_tokenizer`;
}

export function capabilityEntry(name: string, version: string = UCP_VERSION) {
  const ref = OFFICIAL_CAPABILITY_REFS[name];
  if (!ref) throw new Error(`no official reference for ${name}`);
  return { version, spec: ref.spec, schema: ref.schema, ...(ref.extends ? { extends: ref.extends } : {}) };
}

export interface BusinessProfileInput {
  origin: string;
  keys: PublicJwk[];
  handlerNameOverride?: string;
  /** Capabilities to advertise. Default: the full v1 set. */
  capabilities?: readonly string[];
}

export const V1_BUSINESS_CAPABILITIES = [CAP.checkout, CAP.fulfillment, CAP.discount, CAP.order, CAP.catalogSearch, CAP.catalogLookup] as const;

export function buildBusinessProfile(input: BusinessProfileInput): UcpProfile {
  const { origin } = input;
  const caps: CapabilityRegistry = {};
  for (const name of input.capabilities ?? V1_BUSINESS_CAPABILITIES) caps[name] = [capabilityEntry(name)];

  const handlerName = mockHandlerName(origin, input.handlerNameOverride);
  return {
    ucp: {
      version: UCP_VERSION,
      services: {
        [SERVICE_SHOPPING]: [
          {
            version: UCP_VERSION,
            spec: SHOPPING_REST_SERVICE.spec,
            transport: "rest",
            endpoint: `${origin}/api/ucp/v1`,
            schema: SHOPPING_REST_SERVICE.schema,
          },
        ],
      },
      capabilities: caps,
      payment_handlers: {
        [handlerName]: [
          {
            id: "mock_tokenizer_1",
            version: UCP_VERSION,
            spec: `${origin}/docs/mock-tokenizer`,
            schema: `${origin}/schemas/mock_tokenizer.json`,
            available_instruments: [{ type: "card", constraints: { properties: { brand: { enum: ["visa", "mastercard"] } } } }],
            config: {
              simulated: true,
              environment: "sandbox",
              business_id: "demo_merchant",
              tokenize_url: `${origin}/api/mock-psp/tokenize`,
            },
          },
        ],
      },
    },
    keys: input.keys,
  };
}

export interface PlatformProfileInput {
  origin: string;
  version?: string;
  webhookUrl: string;
  /** Capabilities the platform supports. Default mirrors the business v1 set. */
  capabilities?: readonly string[];
  /** Override a capability's advertised version (used by version-skew fixtures). */
  capabilityVersions?: Record<string, string>;
  handlerNameOverride?: string;
}

export function buildPlatformProfile(input: PlatformProfileInput): UcpProfile {
  const { origin } = input;
  const caps: CapabilityRegistry = {};
  for (const name of input.capabilities ?? V1_BUSINESS_CAPABILITIES) {
    const entry = capabilityEntry(name, input.capabilityVersions?.[name] ?? input.version ?? UCP_VERSION);
    caps[name] = [name === CAP.order ? { ...entry, config: { webhook_url: input.webhookUrl } } : entry];
  }
  return {
    ucp: {
      version: input.version ?? UCP_VERSION,
      services: {
        [SERVICE_SHOPPING]: [
          { version: input.version ?? UCP_VERSION, spec: SHOPPING_REST_SERVICE.spec, transport: "rest", endpoint: `${origin}/api/platform/ucp`, schema: SHOPPING_REST_SERVICE.schema },
        ],
      },
      capabilities: caps,
      payment_handlers: {
        [mockHandlerName(origin, input.handlerNameOverride)]: [
          { id: "mock_tokenizer_1", version: input.version ?? UCP_VERSION, spec: `${origin}/docs/mock-tokenizer`, schema: `${origin}/schemas/mock_tokenizer.json`, available_instruments: [{ type: "card" }] },
        ],
      },
    },
  };
}

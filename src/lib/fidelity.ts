/**
 * What this project is, honestly. Shown on the Overview. Mirrors docs/UCP_CAPABILITY_MATRIX.md; a test keeps the key claims
 * from drifting out of it.
 */
export interface FidelitySection {
  id: "real" | "simulated" | "not_implemented" | "deviations";
  title: string;
  tone: "good" | "warn" | "neutral" | "caution";
  items: string[];
}

export const FIDELITY: FidelitySection[] = [
  {
    id: "real",
    title: "Real protocol behavior",
    tone: "good",
    items: [
      "A UCP business implementation: /.well-known/ucp, catalog search and lookup, the checkout lifecycle, Get Order, idempotency, negotiation errors",
      "A platform implementation: discovery, authority binding, version selection, capability intersection, a UCP client with the specified headers",
      "Fulfillment and discount extensions; merchant-authoritative pricing",
      "RFC 9421 signed order webhooks (ES256), with signature verification, signer authorization and de-duplication",
      "Validation of every payload against schemas generated from the official JSON Schema (release 2026-08-25)",
    ],
  },
  {
    id: "simulated",
    title: "Simulated (clearly labelled)",
    tone: "caution",
    items: [
      "The shopping agent: deterministic rules, no model",
      "The credential provider (tokenizer) and the PSP: published test cards only; real card numbers are refused and never stored or logged; no money moves",
      "The shopper's authorization is a real UI step, but it is not an AP2 mandate",
      "Merchant admin actions (ship, cancel, refund) are the business's own tooling, not UCP operations",
    ],
  },
  {
    id: "not_implemented",
    title: "Not implemented",
    tone: "warn",
    items: [
      "AP2 mandates / cryptographic payment authorization",
      "MCP, A2A and embedded transports (REST only)",
      "Identity linking (OAuth), cart, buyer-consent extension, loyalty, split payments",
      "Platform → business request signing (API-key authentication is used; webhooks are signed)",
      "Running the official conformance suite: no conformance claim of any kind is made",
    ],
  },
  {
    id: "deviations",
    title: "Known deviations from the specification",
    tone: "neutral",
    items: [
      "Authority binding for the demo's own payment handler is reported as “relaxed” on localhost and *.vercel.app, which cannot be valid authorities. Capabilities from ucp.dev bind normally",
      "Local development runs over plain http://localhost (the spec requires TLS 1.3)",
      "A missing Request-Id header is tolerated (generated and noted) although the OpenAPI marks it required",
      "Error code names for 404/409/429 responses are demo-chosen; the spec fixes only the HTTP statuses",
    ],
  },
];

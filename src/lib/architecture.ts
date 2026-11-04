/**
 * The architecture diagram as DATA. The page renders it; tests check it against the code (every endpoint named here must be a
 * real route; every edge and tour step must reference real participants and edges). Nothing here is decoration.
 */
export type Kind = "human" | "real" | "simulated";

export interface Participant {
  id: string;
  name: string;
  /** Role in the specification. */
  role: string;
  kind: Kind;
  /** Position in the 1000×520 diagram. */
  x: number;
  y: number;
  responsibility: string;
  does: string[];
  /** Real routes this participant serves (checked against src/app by tests). */
  endpoints: string[];
  /** Where it lives in the code. */
  code: string[];
  pages: { label: string; href: string }[];
  /** What is real and what is not, in plain words. */
  honesty: string;
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  label: string;
  /** `wire` = a UCP message; `handler` = payment-handler step; `internal` = inside one organization; `human` = person ↔ UI. */
  type: "wire" | "handler" | "internal" | "human";
  dashed?: boolean;
  description: string;
  /** Operations as named in the Protocol Inspector. */
  ops: string[];
  spec: string[];
  /** Endpoint paths used on this edge (checked against src/app). */
  endpoints: string[];
}

export interface TourStep {
  id: string;
  title: string;
  narration: string;
  spec: string;
  nodes: string[];
  edges: string[];
  tryIt: { label: string; href: string };
}

export const PARTICIPANTS: Participant[] = [
  {
    id: "shopper",
    name: "Shopper",
    role: "Buyer",
    kind: "human",
    x: 110,
    y: 130,
    responsibility: "States what they want and is the only party who can authorize spending.",
    does: ["Gives a shopping request in natural language", "Reviews the itemized confirmation (items, quantities, discounts, shipping, tax, total, payment method)", "Explicitly authorizes: the click is the consent record"],
    endpoints: [],
    code: ["src/components/checkout/confirmation-card.tsx", "src/platform/consent.ts"],
    pages: [{ label: "AI Agent", href: "/agent" }, { label: "Checkout Playground", href: "/checkout" }],
    honesty: "That's you. AP2 mandates (authorization without a human in the loop) are NOT implemented, so a human click is the only path to Complete Checkout.",
  },
  {
    id: "agent",
    name: "AI shopping agent / Platform",
    role: "Platform",
    kind: "simulated",
    x: 400,
    y: 130,
    responsibility: "Acts for the shopper: discovers the business, negotiates capabilities, calls UCP endpoints, resolves error messages, and presents the trusted confirmation UI.",
    does: ["Fetches and validates /.well-known/ucp, checks authority binding, selects a protocol version, intersects capabilities", "Sends UCP-Agent, Request-Id and Idempotency-Key on every call", "Searches the catalog and builds the checkout through UCP only", "Receives and verifies signed order webhooks"],
    endpoints: ["/api/platform/profile", "/api/platform/webhooks/orders/{platformId}"],
    code: ["src/platform/", "src/platform/agent/", "src/platform/ucp-client.ts", "src/platform/webhook-handler.ts"],
    pages: [{ label: "AI Agent", href: "/agent" }, { label: "Merchant Discovery", href: "/discovery" }, { label: "Webhook Inspector", href: "/webhooks" }],
    honesty: "The UCP client, discovery, negotiation, signature verification and webhook receiver are real code speaking real HTTP. The decision-making is a deterministic, rule-based simulation (no model).",
  },
  {
    id: "merchant",
    name: "Merchant / Business",
    role: "Business (merchant of record)",
    kind: "real",
    x: 700,
    y: 130,
    responsibility: "Publishes its profile, owns pricing, checkout state and orders, and is the merchant of record.",
    does: ["Serves /.well-known/ucp with capabilities, services, payment handlers and signing keys", "Negotiates on every request: fetches the platform profile, checks the version, intersects capabilities", "Recomputes all prices; ignores any price the platform sends", "Runs the checkout status lifecycle and idempotency"],
    endpoints: ["/.well-known/ucp", "/api/ucp/v1/catalog/search", "/api/ucp/v1/catalog/lookup", "/api/ucp/v1/checkout-sessions", "/api/ucp/v1/checkout-sessions/{id}", "/api/ucp/v1/checkout-sessions/{id}/complete", "/api/ucp/v1/checkout-sessions/{id}/cancel", "/api/ucp/v1/orders/{id}"],
    code: ["src/merchant/", "src/merchant/checkout/state-machine.ts", "src/merchant/pricing.ts", "src/merchant/http.ts"],
    pages: [{ label: "Merchant Discovery", href: "/discovery" }, { label: "Checkout Playground", href: "/checkout" }, { label: "Product Catalog", href: "/catalog" }],
    honesty: "A genuine UCP business implementation with a demo catalog. It has not been run through the official conformance suite.",
  },
  {
    id: "orders",
    name: "Order management",
    role: "Business-internal",
    kind: "real",
    x: 700,
    y: 380,
    responsibility: "Holds the order entity, records what happened to it, and tells the platform with signed webhooks.",
    does: ["Creates the order when a checkout completes", "Appends fulfillment events and adjustments (shipped, delivered, canceled, returned, refunded)", "Queues a full-snapshot webhook for every change; signs it (RFC 9421, ES256); retries with backoff"],
    endpoints: ["/api/ucp/v1/orders/{id}"],
    code: ["src/merchant/orders/", "src/merchant/webhooks/outbox.ts", "src/ucp/http-signatures.ts"],
    pages: [{ label: "Order Management", href: "/orders" }, { label: "Webhook Inspector", href: "/webhooks" }],
    honesty: "UCP defines only Get Order and the webhook. Shipping, cancelling and refunding are the business's own actions, so the admin console is NOT a UCP API.",
  },
  {
    id: "cp",
    name: "Credential provider",
    role: "Tokenizer",
    kind: "simulated",
    x: 400,
    y: 380,
    responsibility: "Turns a payment credential into a token bound to one checkout, so the business never handles card data.",
    does: ["Accepts only published test cards; refuses real numbers and never echoes or stores them", "Issues a token bound to the checkout capability and id (a replay guard)"],
    endpoints: ["/api/mock-psp/tokenize"],
    code: ["src/sim/psp.ts", "src/app/api/mock-psp/tokenize/route.ts"],
    pages: [{ label: "Payment Simulator", href: "/payments" }],
    honesty: "SIMULATED. It follows the shape of the spec's Processor Tokenizer example but is not a payment integration and provides no real security.",
  },
  {
    id: "psp",
    name: "Payment service provider",
    role: "PSP",
    kind: "simulated",
    x: 900,
    y: 380,
    responsibility: "Processes the token for the business and reports approval, decline or a pending result.",
    does: ["Re-verifies the token's binding by exact equality", "Returns deterministic outcomes per test card: approved, declined, insufficient funds, asynchronous"],
    endpoints: [],
    code: ["src/sim/psp.ts"],
    pages: [{ label: "Payment Simulator", href: "/payments" }],
    honesty: "SIMULATED. No money moves; outcomes are a fixed table.",
  },
];

export const EDGES: Edge[] = [
  { id: "shopper-agent", from: "shopper", to: "agent", label: "intent · review · authorize", type: "human", description: "The shopper asks for something, the agent presents the checkout, and only the shopper's explicit click authorizes payment. The agent has no route to the consent endpoint.", ops: [], spec: ["checkout/index.md → Overview (trusted UI)"], endpoints: [] },
  { id: "agent-merchant", from: "agent", to: "merchant", label: "UCP over REST", type: "wire", description: "Discovery, catalog search, create/get/update/complete/cancel checkout, Get Order. Every request carries UCP-Agent (the platform profile), Request-Id, and Idempotency-Key on state changes. The business answers with the negotiated version and the capabilities relevant to the operation.", ops: ["get_profile", "search_catalog", "lookup_catalog", "create_checkout", "get_checkout", "update_checkout", "complete_checkout", "cancel_checkout", "get_order"], spec: ["overview → Discovery, Governance, and Negotiation", "checkout/rest.md", "order/rest.md", "catalog/rest.md"], endpoints: ["/.well-known/ucp", "/api/ucp/v1/catalog/search", "/api/ucp/v1/checkout-sessions", "/api/ucp/v1/checkout-sessions/{id}", "/api/ucp/v1/checkout-sessions/{id}/complete", "/api/ucp/v1/orders/{id}"] },
  { id: "agent-cp", from: "agent", to: "cp", label: "tokenize", type: "handler", description: "Platform → credential provider: POST /tokenize with the credential and a binding to the checkout. The result is a token; the business only ever sees the token.", ops: ["tokenize"], spec: ["payment/tokenization.md → Binding", "payment/examples/processor-tokenizer-payment-handler.md"], endpoints: ["/api/mock-psp/tokenize"] },
  { id: "merchant-psp", from: "merchant", to: "psp", label: "charge token", type: "handler", description: "On Complete, the business has its PSP process the token. A decline is not an HTTP error: the checkout returns to incomplete with a recoverable payment_failed message.", ops: [], spec: ["checkout/index.md → Standard Errors (payment_failed)"], endpoints: [] },
  { id: "cp-psp", from: "cp", to: "psp", label: "shared token store", type: "internal", dashed: true, description: "In this demo the tokenizer and the processor are one simulated provider sharing a token store (the spec's \"tokenize to process\" pattern).", ops: [], spec: ["payment/examples/processor-tokenizer-payment-handler.md"], endpoints: [] },
  { id: "merchant-orders", from: "merchant", to: "orders", label: "order created", type: "internal", description: "A completed checkout creates the order inside the business. Get Order later returns its full current state.", ops: [], spec: ["order/index.md → Overview"], endpoints: [] },
  { id: "orders-agent", from: "orders", to: "agent", label: "signed webhooks", type: "wire", description: "Business → platform: POST to the webhook_url the platform advertised, with Webhook-Id, Webhook-Timestamp, UCP-Agent, Content-Digest, Signature-Input and Signature. The body is the full order entity every time. The platform verifies the signature against the key in the business profile and checks that the signer owns the order before applying it.", ops: ["order_event_webhook"], spec: ["order/index.md → Events, Webhook Signature Verification", "signatures.md"], endpoints: ["/api/platform/webhooks/orders/{platformId}"] },
];

export const TOUR: TourStep[] = [
  { id: "discover", title: "1 · The platform discovers the business", narration: "Before anything else the platform fetches /.well-known/ucp. The profile lists services (REST here), capabilities with versions, payment handlers and public signing keys. Nothing about the business is hardcoded in the platform.", spec: "overview → Profile Structure", nodes: ["agent", "merchant"], edges: ["agent-merchant"], tryIt: { label: "Run discovery", href: "/discovery" } },
  { id: "negotiate", title: "2 · Capabilities are negotiated", narration: "The platform checks that each schema URL's host matches the capability's namespace authority, picks the newest mutually supported protocol version, then keeps only capabilities both sides advertise at an exactly shared version, dropping extensions whose parent is missing. The business repeats the check on every request using the UCP-Agent header.", spec: "overview → Negotiation Protocol, Intersection Algorithm", nodes: ["agent", "merchant"], edges: ["agent-merchant"], tryIt: { label: "Try an incompatible platform", href: "/scenarios?s=version-compatibility" } },
  { id: "intent", title: "3 · The shopper states what they want", narration: "“A wireless headphone under ₹5,000 with noise cancellation.” The agent turns this into catalog search parameters with deterministic rules; no model is involved.", spec: "(platform-internal)", nodes: ["shopper", "agent"], edges: ["shopper-agent"], tryIt: { label: "Talk to the agent", href: "/agent" } },
  { id: "search", title: "4 · The agent searches the catalog", narration: "POST /catalog/search with the query and a price filter in minor units. The agent also verifies required features itself rather than trusting search ranking.", spec: "catalog/search.md", nodes: ["agent", "merchant"], edges: ["agent-merchant"], tryIt: { label: "Search the catalog", href: "/catalog" } },
  { id: "create", title: "5 · A checkout session is created", narration: "POST /checkout-sessions with only item ids and quantities: prices are never sent. The business answers with status, recoverable messages saying what is missing, and the totals it calculated.", spec: "checkout/rest.md → Create Checkout", nodes: ["agent", "merchant"], edges: ["agent-merchant"], tryIt: { label: "Open the Checkout Playground", href: "/checkout" } },
  { id: "update", title: "6 · The agent resolves messages; the merchant prices", narration: "Update Checkout is a full replacement: the agent resends everything it wants to keep (buyer, address, shipping choice, codes). The business recomputes subtotal, discounts, shipping, tax and total, and reports ready_for_complete.", spec: "checkout/rest.md → Update Checkout", nodes: ["agent", "merchant"], edges: ["agent-merchant"], tryIt: { label: "Discount and fulfillment scenario", href: "/scenarios?s=discount-fulfillment" } },
  { id: "review", title: "7 · The trusted confirmation is shown", narration: "The shopper sees exactly what will be paid: items, quantities, discounts, shipping, tax, total and payment method, re-read from the merchant, not taken from the agent.", spec: "checkout/index.md → Overview", nodes: ["agent", "shopper"], edges: ["shopper-agent"], tryIt: { label: "See the confirmation card", href: "/agent" } },
  { id: "authorize", title: "8 · Only the shopper authorizes", narration: "The shopper's click records consent bound to the exact total shown and the chosen card; it is single-use and expires in ten minutes. If anything changed meanwhile, Complete is refused. The agent has no route to this step.", spec: "checkout/index.md → Overview (AP2 not implemented)", nodes: ["shopper", "agent"], edges: ["shopper-agent"], tryIt: { label: "Successful purchase scenario", href: "/scenarios?s=successful-purchase" } },
  { id: "tokenize", title: "9 · The card becomes a token (simulated)", narration: "The platform sends a published test card plus a binding to this checkout to the credential provider and receives a token. Real card numbers are refused and never stored or logged.", spec: "payment/tokenization.md", nodes: ["agent", "cp"], edges: ["agent-cp"], tryIt: { label: "Open the Payment Simulator", href: "/payments" } },
  { id: "complete", title: "10 · The business completes the checkout", narration: "POST …/complete with a token credential and a fresh Idempotency-Key. The business has its PSP charge the token. Approval completes the checkout; a decline returns a recoverable payment_failed message and no order is created.", spec: "checkout/index.md → Complete Checkout", nodes: ["agent", "merchant", "psp", "cp"], edges: ["agent-merchant", "merchant-psp", "cp-psp"], tryIt: { label: "Payment failure and retry scenario", href: "/scenarios?s=payment-failure" } },
  { id: "order", title: "11 · An order exists", narration: "Completion creates the order inside the business. GET /orders/{id} returns the full current-state snapshot.", spec: "order/index.md", nodes: ["merchant", "orders", "agent"], edges: ["merchant-orders", "agent-merchant"], tryIt: { label: "Order Management", href: "/orders" } },
  { id: "webhook", title: "12 · The business pushes updates with signed webhooks", narration: "When the business ships the order, it queues the full new snapshot and signs the request. The platform verifies the signature against the key in the business profile, confirms the signer owns the order, de-duplicates by Webhook-Id, acknowledges, and applies it.", spec: "order/index.md → Events; signatures.md", nodes: ["orders", "agent"], edges: ["orders-agent"], tryIt: { label: "Order lifecycle scenario", href: "/scenarios?s=order-lifecycle" } },
];

export const participantById = (id: string) => PARTICIPANTS.find((p) => p.id === id);
export const edgeById = (id: string) => EDGES.find((e) => e.id === id);

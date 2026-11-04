# UCP Glossary

Terms as used in the UCP 2026-08-25 specification and in this project.

| Term | Meaning |
|---|---|
| **UCP** | Universal Commerce Protocol, an open standard for agentic commerce. Date-versioned (`YYYY-MM-DD`). |
| **Platform** | The agent/app acting for the buyer. Publishes a profile, sends `UCP-Agent`, renders the trusted confirmation UI. |
| **Business** | The merchant of record. Publishes `/.well-known/ucp`, implements capabilities, owns pricing and orders. |
| **PSP** | Payment service provider that processes the payment instrument for the business. Simulated here. |
| **Credential Provider (CP) / Tokenizer** | Collects sensitive credentials and issues tokens. Simulated here. |
| **Profile** | JSON discovery document with a required `ucp` member (and optional `keys[]`). Business profile at `/.well-known/ucp`; platform profile at the URL in `UCP-Agent`. |
| **Service** | API surface for a vertical (e.g. `dev.ucp.shopping`) with transport bindings (`rest`, `mcp`, `a2a`, `embedded`). |
| **Capability** | A feature within a service, e.g. `dev.ucp.shopping.checkout`. |
| **Extension** | A capability that augments another via `extends` (fulfillment, discount). |
| **Payment handler** | Spec for how a payment method's credentials are advertised, acquired and processed (e.g. `com.google.pay`). |
| **Payment instrument** | An entry in `payment.instruments[]`: `{id, handler_id, type, credential?, …}`. |
| **Reverse-domain name** | `{reverse-domain}.{service}.{capability}` naming convention; encodes governance authority. |
| **Authority binding** | Rule that a declared `schema` URL's host (reversed) equals or label-prefixes the entity name. Proves provenance, not trust. |
| **Negotiation / intersection** | Selecting active capabilities as those both parties advertise at an exactly shared version, then pruning orphan extensions. |
| **`supported_versions`** | Map of older protocol version → URI of a full leaf profile for that version. |
| **`UCP-Agent`** | Request header carrying the platform profile URL, RFC 8941 dictionary: `profile="https://…"`. |
| **`continue_url`** | URL for buyer handoff / session recovery when the platform cannot proceed in-band. |
| **Checkout session** | The mutable resource at `/checkout-sessions/{id}`. Status: `incomplete`, `requires_escalation`, `ready_for_complete`, `complete_in_progress`, `completed`, `canceled`. |
| **Message severity** | `recoverable`, `requires_buyer_input`, `requires_buyer_review`, `unrecoverable`. |
| **Action** | Extension-defined outstanding work surfaced in a response-only `actions` map. |
| **Order** | Immutable-identity current-state snapshot created by completing a checkout. Read with `GET /orders/{id}`; updated via webhooks. |
| **Expectation / Fulfillment event / Adjustment** | Order parts: buyer-facing delivery promise; append-only shipment log; post-order money/quantity events (refund, return, cancellation). |
| **Webhook (Standard Webhooks)** | Business → platform event POST with `Webhook-Id`, `Webhook-Timestamp`; UCP adds RFC 9421 signatures. |
| **RFC 9421 / RFC 9530** | HTTP Message Signatures / `Content-Digest` body hash, used for webhook authenticity. |
| **Idempotency-Key** | UUID header on state-changing requests; same key + same payload = same result, same key + different payload = `409`. |
| **Request-Id** | UUID header for tracing across components. |
| **AP2** | Agent Payments Protocol; cryptographic mandates enabling checkout without a human-in-the-loop UI. **Not implemented** here. |
| **MCP / A2A** | Model Context Protocol / Agent2Agent protocol. Transport options UCP can ride on; *not* UCP. |
| **JSON Schema validation vs. conformance** | Schema validation checks payload shape. Conformance (official suite) checks protocol behavior against a live server. This project reports them separately. |
| **Simulated** | A participant whose interface is real but whose backing system is fake (mock PSP, mock tokenizer, scripted agent). |

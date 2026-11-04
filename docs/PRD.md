# Product Requirements: UCP Playground

Status: DRAFT for approval · Pinned protocol: UCP `2026-08-25` · Owner: Principal Engineer

## 1. Problem

Developers and product stakeholders can read the UCP specification but cannot *see* the protocol work: discovery,
negotiation, checkout state changes, payment-handler flow, order webhooks. They need a runnable, inspectable
reference where every byte of every interaction is visible.

## 2. Goals

1. A user can open the app, run an end-to-end agentic purchase, and inspect every UCP request/response without reading source.
2. The **business side is a genuine UCP implementation** (spec-shaped payloads, validated with the official SDK schemas).
3. The **platform side uses a real HTTP client** against that business; the "AI agent" decisions are deterministic and rule-based.
4. Explicit distinction in the UI between *real protocol behavior* and *simulated participants*.
5. Deployable as one Next.js app on Vercel, with persistence that survives serverless execution.
6. Honest conformance reporting (official suite results, not UI success).

## 3. Non-goals

* Real payments, real card data, real PSP/credential-provider integrations, PCI scope of any kind.
* AP2 / cryptographic payment mandates, identity linking (OAuth), MCP/A2A/embedded transports (v1).
* Certification or "UCP compliant" claims. The deliverable is a *demonstration* plus a conformance *report*.
* LLM-driven agent (optional later; the demo must run without any model key).

## 4. Personas

| Persona | Needs |
|---|---|
| Protocol-curious developer | See raw payloads, replay requests, validate/break payloads |
| Merchant/platform architect | Understand roles, negotiation, where trust boundaries sit |
| Engineering leader / PM | Guided scenario with plain-language explanation of each step |
| Contributor | Clear module boundaries to extend capabilities |

## 5. Modules (map to the brief, A–H)

| ID | Module | Sidebar | Core requirement |
|---|---|---|---|
| A | Overview dashboard | Overview, Architecture | Clickable architecture diagram; guided demo mode |
| B | Merchant discovery | Merchant Discovery | Live `/.well-known/ucp`, raw JSON, dynamic capability discovery, mismatch & unsupported-version cases |
| C | AI shopping agent | AI Agent, Product Catalog | Rule-based chat agent, activity timeline, all calls via UCP client |
| D | Checkout playground | Checkout Playground | Create/get/update/complete/cancel, discount & fulfillment, errors, **explicit buyer consent screen** |
| E | Payment simulator | Payment Simulator | Mock tokenizer/PSP: success, failure, retry, async; test credentials only |
| F | Order management | Order Management, Webhook Inspector | Get Order, merchant admin console, signed webhooks, idempotent processing |
| G | Protocol inspector | Protocol Inspector | Every request logged with redaction, filter, replay, export |
| H | Schema validator | Schema Validator | Valid/invalid payloads, path-level errors; schema validation ≠ conformance |
| — | Docs | Documentation | In-app rendering of `docs/` |

## 6. Scenarios (must each be independently runnable and resettable)

1. Merchant discovery · 2. Successful purchase · 3. Unsupported capability · 4. Payment failure then retry ·
5. Order lifecycle (webhook) · 6. Version compatibility (compatible and incompatible) · 7. Discount and fulfillment.
Each scenario page lists the protocol sequence, runs against real endpoints, and offers *Reset* (clears only that
demo session's data).

## 7. Functional requirements (selected, testable)

| ID | Requirement |
|---|---|
| FR-1 | `GET /.well-known/ucp` returns a profile that passes SDK `UcpDiscoveryProfileSchema` and the pinned version. |
| FR-2 | The agent derives endpoints and capabilities from the fetched profile; no hardcoded URLs or capability assumptions. |
| FR-3 | Merchant recomputes all prices/totals; client-sent prices are ignored. |
| FR-4 | Checkout status transitions follow the spec diagram only; illegal operations return spec-shaped errors. |
| FR-5 | Completion is impossible without a buyer-consent record produced by the confirmation UI. |
| FR-6 | Mock payment rejects any value that is not a published test credential; no real card data is accepted or stored. |
| FR-7 | Orders are created only by completing a checkout; `GET /orders/{id}` returns the full entity. |
| FR-8 | Webhooks are signed (RFC 9421), verified, deduplicated by `Webhook-Id`, and visible with outcome. |
| FR-9 | Every protocol call appears in the inspector with timestamp, actor, method, URL, headers, bodies, status, duration, validation result, correlation ID. |
| FR-10 | Secrets, API keys, tokens and PII are redacted before logging. |
| FR-11 | Invalid payloads produce validation errors with JSON path and message. |
| FR-12 | Each scenario can be run and reset without affecting other visitors. |

## 8. Non-functional requirements

* Next.js build passes with TypeScript `strict`; zero `any` in protocol code (lint-enforced).
* Serverless-safe: no module-level mutable state for domain data.
* p95 UCP endpoint latency < 300 ms excluding cold start (Redis-backed).
* WCAG AA contrast, keyboard-navigable sidebar and inspector, dark/light.
* All docs updated in the same PR as the behavior they describe.

## 9. Success criteria

The 15 acceptance criteria in the brief, tracked in `IMPLEMENTATION_PLAN.md` §Checklist. Deployment is claimed only
after a real Vercel deploy plus smoke tests.

## 10. Open decisions (need owner input — see message to owner)

1. Persistence provider for Vercel (default proposal: Upstash Redis via Vercel Marketplace).
2. Whether to accept the documented authority-binding deviation when no custom domain is configured.
3. Scope phasing: ship modules in the order of workflow steps 6–11 behind a working vertical slice first.

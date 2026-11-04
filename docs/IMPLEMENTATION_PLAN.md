# Implementation Plan and Checklist

Legend: `[ ]` not started · `[~]` in progress · `[x]` done **with passing test**. Updated at the end of every step.

## Assumptions (documented; reverse by telling me)

1. Pinned protocol: UCP `2026-08-25`; official SDK schemas **vendored** from `js-sdk` 0.6.0 @ `3a86b3a` (npm 0.5.1 fails the pinned profile shape); **Zod 3** (SDK constraint).
2. REST only in v1. MCP, A2A, embedded, identity linking, AP2, cart: not in v1.
3. Persistence on Vercel: Upstash Redis via Marketplace. Local/tests: in-memory.
4. Demo catalog in INR (paise): ~12 products incl. 4 wireless headphones (2 ANC, 2 non-ANC; ≥1 under ₹5,000 with ANC).
5. Authority-binding deviation accepted when no custom domain is set (documented, visible in UI).
6. Next.js 16 (latest stable at implementation time, verified via `npm view next`), Node 22 LTS runtime, npm.
7. shadcn/ui + Tailwind; sidebar shell per brief; dark/light via `next-themes`.
8. Repo is currently empty (no commits); the app is scaffolded at the repo root.

## Milestones (maps to workflow steps)

| # | Milestone (workflow step) | Deliverables | Exit gate |
|---|---|---|---|
| M0 | Research + design docs (steps 1–5) | 10 docs in `docs/` | **Owner approval** |
| M1 ✅ | Foundation (step 6) | Scaffold, strict TS, lint/layering rule, `Store` + adapters, `src/ucp` (profile, negotiation, authority binding, safe-fetch, headers, errors, validation), merchant profile route, discovery UI, inspector recorder skeleton | `unit` + `int:discovery-*`, negotiation vectors green; `next build` passes |
| M2 ✅ | Checkout + payments (step 7) | Catalog, pricing, state machine, fulfillment+discount, idempotency, mock tokenizer/PSP, consent gate, Checkout Playground, Payment Simulator | checkout/payment int tests green |
| M3 ✅ | Orders + webhooks (step 8) | Order service, Get Order, admin console, signer/verifier (RFC 9421), outbox + retry, receiver with dedupe, Order + Webhook UIs | webhook int tests incl. tamper/duplicate/wrong-business green |
| M4 ✅ | Agent (step 9) | Intent parser, planner, timeline, catalog UI, scenario runner 1–7 | scenarios pass via API tests |
| M5 ✅ | Inspector + validator (step 10) | Filters, replay, export, redaction tests; Module H | inspector int + validator unit tests green |
| M6 ✅ | Full UI polish (step 11) | Overview, interactive architecture diagram, guided mode, docs viewer, responsive/dark | component + unit tests; manual 375px overflow audit of all pages, light/dark checks. **Playwright smoke on 3 viewports moved to M7** (not done) |
| M7 | Tests + conformance (step 12) | Playwright 7 flows; run official suite; `CONFORMANCE_REPORT.md` | report written truthfully |
| M8 | Vercel (steps 13–14) | `VERCEL_DEPLOYMENT.md`, `.env.example`, deployment checklist, prod build, smoke tests, **real deploy only if the owner links/authorizes a Vercel project** | build green; deployment claimed only after live smoke tests |
| M9 | Final report (step 15) | Delivery report, outstanding work | — |

## M1 status (completed 2026-11-04)

Implemented and tested (103 tests: `npm test`; `npm run lint`; `next build` all green):

* Scaffold: Next.js 16.4.5 (Cache Components off, deliberately), TS strict, Tailwind 4, shadcn/ui, Vitest, layering lint rules.
* `src/ucp`: constants, authority binding (all 9 spec-table vectors + userinfo/IP/IDN/public-suffix hardening), `UCP-Agent` RFC 8941 parse/serialize, error envelopes with spec HTTP statuses, protocol-version selection, capability intersection with orphan pruning, response-capability selection, SSRF-safe fetch (resolved-IP policy, pinning, no redirects, size/time caps), Ed25519 keys with RFC 7638 `kid`, profile builders.
* `src/persistence`: `Store` interface, `MemoryStore`, `RedisStore` (Upstash). **RedisStore is written but not yet exercised against a live Redis** (no test, no credentials in this session): treat as unverified until M2/M8.
* Merchant: `GET /.well-known/ucp`; platform: `GET /api/platform/profile`; BFF `POST /api/playground/discovery/fetch` (allowlisted origins only).
* Observability: redaction + recorder (discovery calls are logged; inspector UI is M5).
* UI: sidebar shell (12 modules, honest "Mn" badges on unbuilt ones), Overview, working Merchant Discovery with compatible / missing-capability / unsupported-version platform fixtures.

Not done in M1 (by design): checkout, payments, orders, webhooks, agent, inspector UI, validator UI, Playwright tests, conformance, Vercel deploy.

## M2 status (completed 2026-11-04)

Implemented and tested (244 tests, 21 files; `npm run check`; `next build`; manual end-to-end run of the UI in a browser):

* **Merchant (real UCP endpoints):** `POST /catalog/search`, `POST /catalog/lookup` (with `inputs` correlation, dedupe, batch limit), `POST /checkout-sessions`, `GET|PUT /checkout-sessions/{id}`, `POST …/complete`, `POST …/cancel`, `GET /orders/{id}`; cart routes that return the spec'd `capabilities_incompatible`.
* **Shared pipeline** (`src/merchant/http.ts`): rate limit (429 + Retry-After), body cap, `UCP-Agent` negotiation (400/424/422/200 per spec), API-key auth (401), request validation with JSON paths, idempotency (`Idempotency-Key`, replay, 409 on mismatch, serialized per key), outbound response validation against the official schemas (hard-fails outside production), redacted business-side log.
* **Checkout:** spec status lifecycle as data + exhaustive tests; merchant-authoritative pricing; fulfillment extension (address validation, options, free-shipping rule); discount extension (each/across, stacking priority, automatic discount, rejected-code warnings with spec codes); `requires_escalation` (high-value review, no fulfillment extension); `complete_in_progress` (async) with the spec's Update/Complete restrictions; expiry; cancel.
* **Payments (SIMULATED):** tokenizer + PSP following the Processor Tokenizer pattern; binding replay guard; single-use tokens; real card numbers refused and never echoed or logged.
* **Platform:** UCP client (spec headers, local + remote validation, safe retries only, typed errors, recording), buyer-consent gate (itemized, fingerprinted, single-use, 10-minute expiry; Complete is unreachable without it), BFF routes, session reset.
* **UI:** Catalog, Checkout Playground (guided create/update/review/authorize/complete, real exchanges shown), Payment Simulator, shared exchange viewer.

Design decisions this milestone forced (all reflected in code and tests):

| Decision | Reason |
|---|---|
| Update is a *true* full replacement: omitted buyer/fulfillment/discounts/payment are cleared; only line items get per-line rejection that keeps the previous line | Spec: "supplied resource replaces the existing Checkout session state" |
| Create is all-or-nothing for item problems; Update rejects per line, recoverably | Spec example: no resource when all items are out of stock; mixed case is unspecified, so the stricter, documented choice |
| `complete_in_progress` resolves only when observed through Get Checkout | Spec: Get Checkout is the way to observe accepted processing; Update/Complete in that state must leave the checkout unchanged with a recoverable message |
| After a payment failure the checkout is `incomplete` until the platform resubmits through Update; a new Complete uses a fresh `Idempotency-Key` | Spec: recoverable errors are resolved via Update; a genuinely new Complete needs a fresh key |
| HTTP 404 `not_found`, 409 `invalid_state` / `idempotency_conflict`, 429 `rate_limited`: **code names are demo-chosen** | The spec fixes these statuses (or leaves them open) but not the code strings; the inspector flags them "non-normative" |
| Missing `Request-Id` is tolerated (generated, noted) although the OpenAPI marks it required | Leniency for hand-written clients; documented deviation |
| Catalog stock is fixed (never decremented) | Deterministic demos and tests; documented |

Known gaps after M2 (do not treat as done):

* `RedisStore` has still never run against a real Redis; every test uses `MemoryStore`.
* No Playwright tests yet (M7); the UI was verified by a manual browser run only.
* Official conformance suite not run (M7); nothing here is a conformance claim.
* Order events, adjustments, webhook delivery and the admin console are M3. `GET /orders/{id}` works, but orders only have the initial state.
* Merchant-side inspector UI, replay and export are M5; the raw log API exists.

## M3 status (completed 2026-11-04)

Implemented and tested (304 tests, 24 files; lint, typecheck and `next build`; manual run in a browser against the real Next server, so Next's actual `after()` delivered the webhooks):

* **RFC 9421 / 9530** (`src/ucp/http-signatures.ts`): sign and verify, ES256 (default) and Ed25519, raw r||s, spec-required coverage rules, digest check, created/expires window, key lookup by `kid` with unsupported keys skipped. **Cross-checked in both directions against an independent implementation** (`http-message-signatures`) and RFC 8037's thumbprint vector.
* **Business**: order events (shipped, delivered) and adjustments (cancellation, return, refund) with state rules; every change pushes a full-snapshot webhook; an outbox that stores the exact signed bytes, retries with backoff (5 s → 1 h, 6 attempts, then dead), serializes per row, and can be driven by cron or "retry now"; `Order created` is sent on completion; no events if the platform advertised no `webhook_url`; the platform's webhook URL is fetched only through the SSRF-safe, allowlisted fetcher.
* **Platform receiver**: verify signature against the signer's published key (cached, refetched once on unknown `kid`) → timestamp window → payload schema → **authorization (signer must be the business that owns the order)** → dedupe by `Webhook-Id` (only after authentication, so attackers cannot pre-poison ids) → ack → apply asynchronously with last-write-wins on `Webhook-Timestamp`.
* **Security demos** (business plays attacker): tampered body, wrong key, unpublished key, old timestamp, valid signature from the wrong business identity. Each is rejected with the spec's HTTP status and none changes platform state.
* **UI**: Order Management (dashboard, admin console, timeline, Get Order exchange) and Webhook Inspector (outbox with exact payloads and attempts, platform receipts with verdicts, platform-side order state).

Decisions this milestone forced:

| Decision | Reason |
|---|---|
| Merchant signing key switched from Ed25519 to **ES256** | Spec: every verifier MUST support ES256; EdDSA is optional. Ed25519 stays supported and tested. |
| Webhooks also cover `webhook-id` and `webhook-timestamp` in the signature | Beyond the spec minimum; stops an attacker swapping the event id or timestamp |
| Webhook payload is exactly the Order entity; no `event_id` or `created_time` fields | They appear only in a doc example, not in the schema; not invented |
| `fulfilled` counts delivered units; cancellations reduce `quantity.total` (original preserved); returns and refunds are adjustments only | Spec leaves these open; documented demo semantics |
| One receiver URL per demo platform: `/api/platform/webhooks/orders/{platformId}` | A single deployment hosts many demo platforms; the path identifies which one |
| Order bookkeeping on the platform (`p:` namespace) | The authorization check needs to know which business owns each order |

Known gaps after M3 (do not treat as done):

* `RedisStore` still never exercised against a real Redis.
* Hobby-plan cron runs at most daily; retries rely on "retry now" and delivery-on-activity there.
* A single-process in-memory run cannot show cross-instance races; the Redis lock path is untested.
* Platform → business request signing is still not implemented (API-key auth); response signing is not implemented.
* No Playwright or official conformance run yet (M7).

## M4 status (completed 2026-11-04)

Implemented and tested (369 tests, 27 files; lint, typecheck, `next build`; plus manual runs in a browser of the agent chat → confirmation → order, and scenario 2 through all 11 steps with the real buyer click):

* **Agent** (`src/platform/agent/`): deterministic intent parser (budgets in ₹/Rs/k/lakh, minimums, required features, quantity, codes); a state machine (idle → proposing → checkout → awaiting_consent → ordered); tools that go only through the platform UCP client. It reads the profile and checks the negotiated capabilities *before* using one, verifies required features against the products itself (it does not trust search ranking), resolves the merchant's recoverable `messages[]` using the spec's error-processing approach (buyer details, address, shipping option) with full-replacement updates, hands off via `continue_url` on `requires_escalation`, applies codes/quantity/shipping on request, re-presents after a payment failure with a different default card, and polls Get Checkout for async completion.
* **Activity timeline**: every protocol step records the Request-Id of the real exchange behind it; tests prove each linked step exists on both the platform and the business side.
* **Consent hardening**: the agent module cannot reach consent or Complete (enforced by a test that scans its source and by the layering lint). Authorization now requires `expectedTotal`, the amount the buyer was shown; the server refuses if the live total differs. A forged "I authorized" event cannot make the agent believe an order exists, because it re-reads the checkout from the merchant.
* **Scenarios** (`src/app-services/scenarios/`): all seven required scenarios as step engines. Each step states what the spec says, performs it for real, and shows the actual exchanges and facts extracted from real responses. Buyer steps *prepare* a confirmation and *verify* by reading the merchant; they never authorize. Every scenario is independently runnable and resettable (reset deletes the session's data on both sides); visitors are isolated.
* **UI**: AI Agent (chat, shortlist, confirmation card, timeline, editable synthetic buyer profile, platform fixture selector), Guided Scenarios (step list, run-to-next-buyer-step, reset), and a reusable confirmation card.

Decisions this milestone forced:

| Decision | Reason |
|---|---|
| Consent now needs `expectedTotal` (also for the Checkout Playground) | Previously the consent fingerprint came from the live state at click time, not from what the buyer saw |
| Scenario step 8+9 of the brief ("reviews" + "explicitly authorizes") are one buyer step | Review and authorization are the same trusted-UI interaction |
| Added a 13th sidebar entry, "Guided Scenarios" | The brief requires a scenario library but its 12-item sidebar has no slot for it |
| Scenario 3 deliberately calls `POST /carts` although cart is not negotiated; the chat agent refuses to | The scenario must show the business's error; a well-behaved agent checks first, and the agent test proves it does |
| Unauthenticated catalog calls are still logged under the caller when a valid platform key is sent | Without it the Protocol Inspector could not join both ends of a catalog call |

Known gaps after M4 (do not treat as done):

* **No automated browser tests yet.** A React runtime error on the Agent page (an effect returning a value) was invisible to all 369 tests and was caught only by running the page. Playwright is M7; until then UI behavior is verified manually.
* `RedisStore` still never exercised against a real Redis.
* Agent natural-language coverage is a fixed rule set; unrecognized phrasing gets a help reply (tested), not a guess.
* The scenarios page has no automated UI test.
* Platform → business request signing, official conformance run, Vercel deployment: unchanged (M7/M8).

## M5 status (completed 2026-11-04)

Implemented and tested (456 tests, 29 files; lint, typecheck, `next build`; plus manual runs in a browser: inspector timeline, expand, replay with a correct "different" verdict, and the validator's examples, JSON syntax error, spec-rule failure and "load from inspector" deep link):

* **Protocol Inspector** (`/inspector`): every interaction in chronological order with timestamp, actor, method, endpoint, request/response headers and bodies, status, duration, schema-validation verdicts, Request-Id and error details. **Both ends are joined by Request-Id; webhook deliveries are now recorded on both the sender and the receiver** (joined by Webhook-Id), including security-demo attempts and the receiver's verdict. Filters by actor, operation, status class (2xx, 4xx, 5xx, no response, schema-failed), free text and correlation id, with facets and a summary; live refresh; expandable request/response panels with syntax-highlighted JSON; Copy JSON and Copy as cURL (credentials become `$PLACEHOLDERS`); NDJSON export honoring the filters.
* **Replay** for read-only platform requests only (`get_profile`, `get_checkout`, `get_order`, `search_catalog`, `lookup_catalog`): re-issued with fresh headers, recorded as a new pair of exchanges tagged "Replay of …", and compared with the original (identical, or the list of changed paths). State-changing calls, business-side records and webhooks are refused with the reason, because a redacted log cannot reproduce them faithfully and a repeat could change state.
* **Schema Validator** (`/validator`): ten message types (both profiles, create/update/complete requests, checkout response, order, catalog search request/response, error response), each with a valid example and 1–4 invalid ones built from the project's own code (so they cannot drift) and verified by tests. Reports JSON path, message, expected, received and the actual value; surfaces the closest branch of union failures; reports JSON syntax errors; shows the official source schema document next to the result and the actual payload; can load any real recorded body from the inspector (or deep-link from a row).
* **Layering of claims**: the page separates (1) JSON Schema validation, (2) spec-rule checks that no schema can express (each cited to a spec location, or labelled a heuristic), and (3) an explicit "not conformance" statement listing what is not checked. Two invalid examples are schema-valid on purpose and fail only a rule, to show the difference.

A leak found and fixed while building this: **interaction records contained the demo session id, which is the HttpOnly cookie value**, and several BFF responses returned them to the browser. Records no longer have a session id at all; a test asserts that neither the events API, the export, nor any call response contains the cookie value, API keys, payment tokens, card numbers, raw email or street address.

Decisions this milestone forced:

| Decision | Reason |
|---|---|
| Validation uses the Zod schemas generated from the official JSON Schema; the official JSON documents are vendored for display only | The upstream resolver (`ucp-schema`, Rust) is unavailable here, and the raw source schemas carry `ucp_request/ucp_response` annotations that need it. The UI says so. |
| Mutating operations are not replayable from the log | See above; the Checkout Playground's "Replay with the same Idempotency-Key" has the real body and covers idempotent replay |
| Spec-rule checks are tagged `spec`, `heuristic` or `info` | Only quote the spec where it states a rule; "total equals the sum of the parts" is a consistency check, not a spec formula |
| Objects with open schemas accept extra members and are not flagged | UCP objects are open for extension; flagging them would be wrong |

Known gaps after M5 (do not treat as done):

* The official conformance suite has still not been run (M7). The validator checks shape only and says so.
* Validation is against generated Zod schemas, not the raw official JSON Schema documents.
* No automated browser tests (Playwright, M7); the inspector and validator UIs were verified by hand.
* `RedisStore` still never exercised against a real Redis. The per-session log is capped at 2,000 entries.

## M6 status (completed 2026-11-04)

Implemented and tested (581 tests, 38 files; typecheck, lint and `next build` clean; plus manual browser checks listed below):

* **Overview** with a build-status block and a **Spec fidelity** panel that separates real protocol behavior, clearly labelled simulated participants, and what is not implemented (data in `src/lib/fidelity.ts`, covered by `tests/unit/fidelity.test.ts`).
* **Interactive architecture diagram** (`/architecture`): six participants and the messages between them, generated from `src/lib/architecture.ts`, which tests check for internal consistency and against the code (every page and scenario link resolves, edge operations are ones the platform client performs, named source paths exist, simulated participants are labelled as such; endpoint strings are not machine-checked). Click a box or a message for its responsibility, the endpoints it really serves and what is simulated; keyboard-friendly lists duplicate the diagram; a **guided tour** of one complete purchase (auto-play, honors reduced motion) links into the other modules. Component tests: `tests/components/architecture-explorer.test.tsx`.
* **Docs viewer** (`/docs`, `/docs/[slug]`): the repository's Markdown rendered statically with a safe pipeline (raw HTML skipped, links resolved to in-app routes or repo paths). New docs: `SCENARIOS.md`, `TESTING.md`, `TROUBLESHOOTING.md`.
* **States and accessibility**: skip link, route-level `loading`, `error` and `not-found` pages, error-state component tests (`tests/components/error-states.test.tsx`), inspector deep links through URL parameters.
* **Responsive and theme audit (manual, not automated)**: with the viewport emulated at 375x812, every one of the 14 dashboard pages was checked for horizontal overflow. One failure was found and fixed: the Architecture page's participant/message lists used an implicit grid column that grew to the width of its content (`main` was 441px wide); it now uses `grid-cols-1` with `min-w-0` sections. Architecture, Overview and a docs page were also looked at in dark and light themes.

Decisions this milestone forced:

| Decision | Reason |
|---|---|
| The diagram and tour are generated from one data module that tests cross-check against the code | A hand-drawn diagram drifts; a claim like "the Merchant serves /orders/{id}" must stay true |
| The Playwright viewport smoke test is deferred to M7 | Playwright is introduced with the e2e flows; claiming it here would be false |
| The architecture SVG keeps a 640px minimum width inside a horizontal scroll container on phones | Labels become unreadable if it is scaled to 375px; the lists below it are the small-screen path |

Known gaps after M6 (do not treat as done):

* No Playwright tests: responsive and theme checks above were made by hand at one phone width and one desktop width, in one browser.
* No automated accessibility scan (axe or similar); only the skip link, roles and labels are tested at the component level.
* The official conformance suite has still not been run (M7); `RedisStore` never exercised against a real Redis; platform → business request signing not implemented; not deployed.

## Acceptance checklist (from the brief, §Phase 12)

| # | Criterion | Status | Evidence required |
|---|---|---|---|
| 1 | Application builds | [x] | `next build` succeeded 2026-11-04 (M1 scope) |
| 2 | Discovery endpoint returns a valid profile | [x] | `tests/integration/discovery.test.ts` (validates against official `ProfileBusinessSchema`); live curl against `next dev` |
| 3 | Capabilities dynamically discoverable | [~] | Platform discovery derives endpoint/capabilities from the fetched profile (tested). Agent use of it lands in M4 |
| 4 | Agent communicates through the UCP adapter | [x] | `tests/integration/agent.test.ts`: agent code cannot import merchant code or reach consent; every timeline step maps to a real logged exchange on both sides |
| 5 | Spec-compliant checkout payloads | [~] | Every checkout/order/catalog response and request is validated against the official schemas in tests (strict outbound validation); official conformance run still pending (M7) |
| 6 | Explicit buyer authorization | [~] | Consent gate unit tests; BFF tests (refused without consent, with stale consent, or with a total other than the one shown); agent and scenarios proven unable to authorize; UI verified manually in the browser; Playwright test pending (M7) |
| 7 | Mock transaction completes | [x] | `tests/integration/payment.test.ts`, `bff-flow.test.ts`; completed in the browser UI |
| 8 | Order generated and retrieved | [x] | `payment.test.ts` (Get Order validates against `OrderSchema`, tenancy, not_found) |
| 9 | Webhook events demonstrable | [x] | `tests/integration/webhooks.test.ts`, `admin-bff.test.ts`; Webhook Inspector verified in the browser |
| 10 | Requests/responses visible | [x] | `tests/integration/inspector.test.ts` (captured fields, both ends incl. webhooks, filters, export, replay, redaction); Protocol Inspector verified in the browser; Playwright e2e pending (M7) |
| 11 | Invalid payloads → understandable errors | [x] | `tests/unit/validator.test.ts` (62 tests: every example verified, paths/expected/received/actual, union flattening, syntax errors) and the Validator page verified in the browser |
| 12 | All 7 guided scenarios work | [~] | All seven run end to end and reset cleanly in `scenarios.test.ts` (real HTTP, real authorize endpoint); scenario 2 also run through the UI in a browser; Playwright e2e pending (M7) |
| 13 | Automated tests pass | [ ] | CI output |
| 14 | Vercel configuration complete | [ ] | docs + `.env.example` + prod build |
| 15 | Documentation available | [~] | research/design docs, SCENARIOS, TESTING, TROUBLESHOOTING written and viewable at `/docs` (`tests/unit/docs.test.tsx`); VERCEL_DEPLOYMENT and CONFORMANCE_REPORT still to come (M7/M8) |

## Documents

| Doc | Status |
|---|---|
| UCP_RESEARCH, SPECIFICATION_MAPPING, CAPABILITY_MATRIX, GLOSSARY | written (M0) |
| PRD, SDD, ARCHITECTURE, API_DESIGN, SECURITY_DESIGN, IMPLEMENTATION_PLAN | written (M0) |
| README, SCENARIOS, TESTING, TROUBLESHOOTING | written (M6) |
| CONFORMANCE_REPORT | M7 |
| VERCEL_DEPLOYMENT | M8 |

## Outstanding risks / unknowns

| Risk | Mitigation |
|---|---|
| SDK 0.5.1 may not match every pinned-spec nuance (it is generated; the spec tag has later backports) | `unit:adapter-parity` + fixtures lifted from spec examples; document divergences |
| Official conformance suite expects behaviors/data specific to its flower-shop fixtures | Provide our own `conformance_input.json`/fixtures; mark unsupported/skipped honestly |
| `ucp-schema` CLI (for resolved JSON Schemas in Module H) availability | Fall back to SDK Zod only and label validator "Zod (SDK)" not "JSON Schema" |
| Loopback HTTP on Vercel under Deployment Protection | Bypass-secret header; documented |
| Hobby-plan cron granularity limits webhook retry demonstration | Manual "retry now" + retry piggyback |
| Scope size | Vertical slice first (M1–M3 on one scenario) before breadth; no module marked done without tests |

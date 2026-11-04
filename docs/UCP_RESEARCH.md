# UCP Research Notes

Research performed 2026-11-04 against the official repositories (cloned and read locally, not summarized from memory).
Everything here is traceable to a file in `Universal-Commerce-Protocol/ucp` at tag `v2026-08-25`
unless it says otherwise.

## 1. Version selection

| Item | Value |
|---|---|
| **Selected UCP version** | `2026-08-25` (date-based version, format `YYYY-MM-DD`) |
| Why | Newest dated stable release. Releases that exist: `2026-01-11`, `2026-01-23`, `2026-04-08`, `2026-08-25`. `main` is the draft/development line and is **not** used. |
| Source of truth | `Universal-Commerce-Protocol/ucp`, tag `v2026-08-25` (branch `release/2026-08-25`) |
| Pinned commit | `87dd4b1fcff9105d68173120897237fa784c74ef` (the tag resolves here; committer date 2026-10-22, i.e. the tag includes later backports to the release branch, which the versioning policy allows) |
| Official spec URL | `https://ucp.dev/2026-08-25/specification/overview/` (docs mirror of `docs/specification/overview/index.md`) |
| Schema base URL | `https://ucp.dev/2026-08-25/schemas/...` and `https://ucp.dev/2026-08-25/services/...` |
| JS SDK | **Vendored** official source: `js-sdk` commit `3a86b3a760c3c15d3bf5c44e018e532d4b44e616` (package `0.6.0`, generated against `2026-08-25`), in `src/vendor/ucp-sdk/`. **Not** `@ucp-js/sdk@0.5.1` from npm: although its README maps 0.5.x → 2026-08-25, its `UcpDiscoveryProfileSchema` rejects a 2026-08-25 profile (expects `capabilities` as an array and `services[name]` as an object; the pinned spec uses name-keyed registries of arrays). Verified 2026-11-04 with the spec's own business-profile example: 0.5.1 fails, 0.6.0 passes. Switch to npm once ≥0.6.0 is published. |
| Zod | SDK depends on `zod ^3.23.8`; the app uses **Zod 3** (3.25.x) to share schemas with the SDK. |

The profile `ucp.version` MUST be a dated release; `"draft"` is forbidden in public discovery
(`overview/index.md` → *Pre-release Versions*). The app pins `2026-08-25` as a constant and a CI check fails if
any schema URL references another version.

## 2. What UCP is (and is not)

UCP is an open standard for agentic commerce between **platforms** (AI agents/apps acting for a buyer), **businesses**
(merchants of record), payment service providers and credential providers. The business stays Merchant of Record.

* UCP is **not** MCP and **not** A2A. Those are *transport bindings* UCP can ride on. Official transports in the
  profile `transport` field: `rest`, `mcp`, `a2a`, `embedded`. REST is the primary demonstration here.
* Reverse-domain naming (`dev.ucp.shopping.checkout`) encodes governance; `dev.ucp.*` is reserved for the UCP body.
* Capability *negotiation* is a set intersection over **exact version equality** (not date ordering) between
  business and platform profiles. Protocol *version selection* happens first (`version` / `supported_versions`).

## 3. Architecture and roles

| Role | Responsibility in spec | Role in this demo |
|---|---|---|
| Platform | Publishes a profile; sends `UCP-Agent: profile="…"` on every request; fetches and composes schemas; presents a trusted UI for buyer consent | **Simulated** AI shopping agent + platform backend (real HTTP client code, scripted decisions) |
| Business | Publishes `/.well-known/ucp`; implements capabilities; computes totals; is Merchant of Record | **Real UCP server implementation** (demo catalog, deterministic pricing) |
| Credential Provider / Tokenizer | Collects payment credentials, issues tokens (handler-specific) | **Simulated** mock tokenizer; never handles real card data |
| PSP | Processes the token for the business | **Simulated** mock PSP inside the business, deterministic outcomes |
| Order management | Order entity + webhooks business → platform | Real order capability (Get Order + signed webhooks); fulfillment events are produced by a *merchant admin* panel that is **outside** UCP |

## 4. Discovery

* `GET /.well-known/ucp` returns `{ "ucp": { version, supported_versions?, services, capabilities?, payment_handlers }, "keys"?: [JWK] }`.
  `services` and `payment_handlers` MUST be present even when empty.
* `services["dev.ucp.shopping"][]` entries: `{version, transport, endpoint, schema, spec}`; OpenAPI paths are appended
  to `endpoint` (no trailing slash).
* `capabilities[name][]` entries: `{version, spec, schema, extends?, config?}`. Extensions use `extends` (string or array).
* `payment_handlers[handler_name][]` entries: `{id, version, spec, schema, available_instruments[], config}`.
* `supported_versions` maps an older version → URI of a *complete leaf profile* whose `ucp.version` equals the key and
  that has no `supported_versions` itself.
* Platforms MUST validate **authority binding** of every `schema` URL (host reversed must equal or be a label-aligned
  prefix of the entity name; https; no userinfo; ≥2 labels; no IP literals; no redirects) *before* fetching, and MUST
  apply SSRF/resolved-address protection on fetch.

## 5. Negotiation

1. Platform sends `UCP-Agent: profile="https://…"` (RFC 8941 Dictionary Structured Field) on every request.
2. Business fetches the platform profile (cache allowed), validates version → `version_unsupported` (REST **422**) if
   neither `version` nor a `supported_versions` key matches.
3. Intersection algorithm: same capability name; mutual exact version (highest chosen); prune orphan extensions
   (`extends` parent missing) repeatedly.
4. Business echoes the result in every response: `ucp.version` and `ucp.capabilities` (only the *relevant* ones for the
   operation: checkout → checkout + its active extensions; order → order).
5. Failures: `invalid_profile_url` 400, `profile_unreachable` 424, `profile_malformed` 422, `version_unsupported` 422,
   `capabilities_incompatible` **200** with a UCP error body (`ucp.status: "error"`, `messages[]`, optional `continue_url`).

## 6. Checkout (REST binding)

| Operation | Method / path | Notes |
|---|---|---|
| Create | `POST /checkout-sessions` | 201. Required headers per OpenAPI: `Idempotency-Key` (uuid), `Request-Id` (uuid); `UCP-Agent` |
| Get | `GET /checkout-sessions/{id}` | 200 |
| Update | `PUT /checkout-sessions/{id}` | **Full replacement** of the checkout resource; platform resends everything it wants to keep |
| Complete | `POST /checkout-sessions/{id}/complete` | Requires `payment` (schema: required on complete). 200 with `status: completed` + `order`, or `complete_in_progress` (no `order`) |
| Cancel | `POST /checkout-sessions/{id}/cancel` | Any status except `completed`/`canceled` SHOULD be cancelable |

Status values (exact): `incomplete`, `requires_escalation`, `ready_for_complete`, `complete_in_progress`, `completed`,
`canceled`. Message `severity`: `recoverable`, `requires_buyer_input`, `requires_buyer_review`, `unrecoverable`.
Standard error codes: `out_of_stock`, `item_unavailable`, `address_undeliverable`, `payment_failed`, `eligibility_invalid`.
Totals are an **array** of `{type, amount, display_text?}` in minor units; line items carry their own `totals`.
Business-created `expires_at` default TTL is 6 hours. The checkout "has to be finalized manually by the user through a
trusted UI unless the AP2 Mandates extension is supported" (checkout/index.md, Overview).

## 7. Extensions used

* **Fulfillment** `dev.ucp.shopping.fulfillment` (extends checkout): `fulfillment.methods[]` → `destinations[]`,
  `groups[]` → `options[]`; selection via `selected_destination_id`, `selected_option_id`.
* **Discount** `dev.ucp.shopping.discount` (extends checkout and cart): request `discounts.codes[]` (replacement
  semantics), response `discounts.applied[]` with `method` (`each`/`across`) and `allocations[]`; rejected codes arrive in
  `messages[]`.

## 8. Payment

* Handlers are advertised in the business profile and echoed in every checkout response `ucp.payment_handlers`.
* The platform acquires a credential via the handler's flow and submits it in `payment.instruments[]`
  (`{id, handler_id, type, credential?, billing_address?, display?}`).
* The official worked example used as the pattern here is the **Processor Tokenizer** handler
  (`payment/examples/processor-tokenizer-payment-handler.md`): platform → tokenizer `/tokenize` (with `binding` =
  `{type: "dev.ucp.shopping.checkout", id}` as a replay guard) → token credential → complete checkout.
* AP2 mandates (`payment/extensions/ap2-mandates.md`) require cryptographic signing; **not implemented** in this demo.

## 9. Order

* Orders are created by a successful **Complete Checkout**; there is **no Create Order endpoint**.
* Only one REST operation: `GET /orders/{id}` (current-state snapshot).
* Lifecycle is pushed via **webhooks**: the platform advertises `webhook_url` in its `dev.ucp.shopping.order`
  capability `config`; the business POSTs the **full order entity** per event with Standard Webhooks headers
  (`Webhook-Id`, `Webhook-Timestamp`) plus RFC 9421 signature headers (`UCP-Agent`, `Signature-Input`, `Signature`,
  `Content-Digest`). Platform MUST ack quickly with 2xx and process asynchronously; business MUST retry failures.
* Platform must verify the signer's profile key (`keys[]` in the business profile) *and* that the order belongs to that
  business (authorization step).
* Fulfillment = `expectations[]` (promises) + `events[]` (append-only); `adjustments[]` for refunds/returns/cancellations.
  `type` fields are open strings.
* Cancellation / returns: the spec defines the *data* (adjustments) and the `order:manage` scope but **no REST
  operation** to request them in this release. The demo shows them as business-originated adjustment events only.

## 10. Security model

* Transport: HTTPS, TLS 1.3 minimum (REST binding).
* Authentication is optional per business policy; mechanisms: open, API key (`X-API-Key`), OAuth 2.0 bearer, mTLS,
  RFC 9421 HTTP Message Signatures.
* Replay protection is business-layer idempotency (`Idempotency-Key`; `409` when reused with a different payload).
* Webhooks MUST be signed (RFC 9421) with keys from the business profile `keys[]`. ES256 is the universal baseline every verifier MUST support; Ed25519 is optional. (The demo signs with ES256.)
* Signals, attribution and buyer-consent extensions exist; only consent semantics are relevant to the trusted-UI flow.

## 11. Official artifacts reviewed

| Repo | Findings |
|---|---|
| `ucp` | Spec docs in `docs/specification`, machine-readable JSON Schema in `source/schemas`, OpenAPI in `source/services/shopping/rest.openapi.json`, OpenRPC for MCP/embedded. Governance is date-release branches. |
| `js-sdk` | `@ucp-js/sdk`: **generated Zod schemas + TS types only** (npm 0.5.1: ≈313 `*Schema` exports; repo main 0.6.0: ≈355). No HTTP client, no server, no negotiation, no signing. Extension-composed schemas are pre-generated (e.g. `CheckoutWithDiscountResponseSchema`, `CheckoutWithFulfillmentCreateRequestSchema`). |
| `samples` | `rest/nodejs` (Hono + Zod + SQLite, pins SDK `0.4.5` → schema 2026-04-08), `rest/python` FastAPI server/client, legacy A2A sample (unmaintained). Useful as a behavioral reference; **not** a drop-in because it targets an older release and SQLite. |
| `conformance` | Python/pytest suite (`uv`). Runs against a live server given `SERVER_URL`, `SIMULATION_SECRET`, `conformance_input.json`, `test_fixtures.json`. Needs a `/testing/simulate-shipping/{order_id}` endpoint guarded by a `Simulation-Secret` header and seeded data (flower-shop reference). It spawns a mock agent profile server on port 8285. |

## 12. Decisions and risks that fall out of the research

1. **SDK = validation only, and the npm build lags the spec.** Protocol logic (negotiation, authority binding, idempotency, signing, webhook delivery)
   is implemented natively behind a `ProtocolAdapter` interface; the SDK Zod schemas are the shape validators.
2. **Authority binding vs. hosting.** The demo's custom handler name must bind to its schema host. `localhost` and
   `*.vercel.app` (a public suffix) are not valid authorities per spec. See `UCP_CAPABILITY_MATRIX.md` → Known deviations.
3. **No orders endpoints beyond Get Order**; the "Order Management" module is a business-internal admin console that
   emits spec-shaped webhooks. That boundary must be visible in the UI.
4. **Conformance requires a testing endpoint** that is not part of UCP; it will be implemented, secret-guarded and
   disabled in production deployments.
5. **Currency.** Spec amounts are integer minor units with ISO 4217 `currency`. The demo catalog is priced in INR (paise)
   so the "under ₹5,000" scenario works; the flow is currency-agnostic.

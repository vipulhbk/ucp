# UCP Specification Mapping

Pinned release: **UCP `2026-08-25`** (tag `v2026-08-25`, commit `87dd4b1`). Spec paths are relative to
`ucp/docs/specification/`; schema paths relative to `ucp/source/`. SDK = `@ucp-js/sdk@0.5.1`.

**Status of every row below: PLANNED.** Nothing in this table is implemented yet. The *Test* column names the test that
must exist before the row may be marked done (ID format `unit:` / `int:` / `e2e:` / `conf:`).
Each row flips to DONE only in the implementation checklist (`IMPLEMENTATION_PLAN.md`), with a passing test.

| Feature | Official specification | Schema | Demo implementation | Test |
|---|---|---|---|---|
| Business profile at `/.well-known/ucp` | `overview/index.md` → Profile Structure, Business Profile | `schemas/profile.json` (`business_schema`), `schemas/ucp.json` | `GET /.well-known/ucp` route built by `merchant/profile.ts` | `int:discovery-profile-valid` (validate with SDK `UcpDiscoveryProfileSchema`) |
| Platform profile | `overview/index.md` → Platform Profile | `schemas/profile.json` (`platform_schema`) | `GET /platform/profile.json` | `int:platform-profile-valid` |
| Signing keys in `keys[]` (JWK Set) | `overview/index.md` → Profile Structure; `signatures.md` | RFC 7517 JWK | Merchant Ed25519/ES256 public key published; private key from env | `unit:keys-roundtrip` |
| Service registry + REST endpoint resolution | `overview/index.md` → Services, Endpoint Resolution | `schemas/service.json` | `services["dev.ucp.shopping"]` rest entry, `endpoint` = `{origin}/api/ucp/v1` | `int:endpoint-resolution` |
| Capability registry + extensions (`extends`) | `overview/index.md` → Capabilities, Extensions | `schemas/capability.json` | checkout, fulfillment, discount, order, catalog.search, catalog.lookup | `unit:profile-capabilities` |
| Reverse-domain naming | `overview/index.md` → Namespace Governance | `common/types/reverse_domain_name.json` | `validateCapabilityName()` | `unit:naming` |
| Authority binding of `schema` URLs | `overview/index.md` → Authority Binding (derivation algorithm table) | — | `platform/authority-binding.ts` (all 9 table rows as test vectors) | `unit:authority-binding-vectors` |
| Fetch-safety / SSRF guard on profile & schema fetch | `overview/index.md` → Enforcement, Security | — | `platform/safe-fetch.ts` (https-only, resolved-IP denylist, no redirects, host allowlist in demo) | `unit:ssrf-guard` |
| Protocol version selection, `supported_versions` | `overview/index.md` → Versioning → Protocol Version | `schemas/ucp.json` | `negotiation/version.ts`; leaf profile at `/.well-known/ucp/2026-04-08` (advertised legacy profile) | `unit:version-selection` |
| `version_unsupported` error (HTTP 422) | `overview/index.md` → Error Codes | `common/types/error_response.json` | merchant negotiation middleware | `int:version-unsupported` |
| Capability intersection algorithm | `overview/index.md` → Intersection Algorithm | — | `negotiation/intersect.ts` | `unit:intersection` (incl. orphan pruning, multi-parent) |
| `capabilities_incompatible` (HTTP 200 + error body) | `overview/index.md` → Error Codes | `common/types/error_response.json` | negotiation middleware | `int:capabilities-incompatible` |
| `UCP-Agent` header (RFC 8941 dictionary) | `overview/index.md` → Platform Advertisement on Request | — | `http/ucp-agent.ts` parse/serialize | `unit:ucp-agent-header` |
| Profile errors `invalid_profile_url` 400, `profile_unreachable` 424, `profile_malformed` 422 | `overview/index.md` → Error Codes | — | merchant negotiation middleware | `int:profile-errors` |
| Response `ucp` envelope (`version`, relevant `capabilities`, `payment_handlers`) | `overview/index.md` → Business Requirements, Response Capability Selection | `ucp.json#/$defs/response_checkout_schema` | `merchant/envelope.ts` | `unit:response-capability-selection` |
| Catalog search | `shopping/catalog/search.md`, `catalog/rest.md` | `schemas/shopping/catalog_search.json` | `POST /api/ucp/v1/catalog/search` | `int:catalog-search` |
| Catalog lookup | `shopping/catalog/lookup.md` | `schemas/shopping/catalog_lookup.json` | `POST /api/ucp/v1/catalog/lookup` | `int:catalog-lookup` |
| Create checkout | `shopping/checkout/index.md` → Create Checkout; `checkout/rest.md` | `schemas/shopping/checkout.json` (op `create`), SDK `CheckoutCreateRequestSchema` | `POST /api/ucp/v1/checkout-sessions` → 201 | `int:checkout-create` |
| Get checkout | same, Get Checkout | `checkout.json` (read), SDK `CheckoutSchema` | `GET /api/ucp/v1/checkout-sessions/{id}` | `int:checkout-get` |
| Update checkout (full replacement) | `checkout/rest.md` → Update Checkout | `checkout.json` (op `update`), SDK `CheckoutUpdateRequestSchema` | `PUT /api/ucp/v1/checkout-sessions/{id}` | `int:checkout-update-replaces` |
| Complete checkout | `checkout/index.md` → Complete Checkout | `checkout.json` (op `complete`), SDK `CheckoutCompleteRequestSchema` | `POST …/{id}/complete` | `int:checkout-complete` |
| Cancel checkout | `checkout/index.md` → Cancel Checkout | `checkout.json` | `POST …/{id}/cancel` | `int:checkout-cancel` |
| Checkout status lifecycle | `checkout/index.md` → Checkout Status Lifecycle, Status Values | `checkout.json#/properties/status` | `merchant/checkout-state-machine.ts` (transition table lifted from spec diagram) | `unit:checkout-transitions` (illegal transitions rejected) |
| `complete_in_progress` rules (no Update/Complete while in progress) | `checkout/index.md` → Accepted completion | — | state machine + `int` test with async-completion payment mode | `int:complete-in-progress-guards` |
| Error messages: `type`, `code`, `severity`, `path` | `checkout/index.md` → Error Handling | `common/types/message_error.json`, `message.json` | `merchant/messages.ts`; severities `recoverable` / `requires_buyer_input` / `requires_buyer_review` / `unrecoverable` | `unit:message-shapes` |
| Standard error codes | `checkout/index.md` → Standard Errors | `common/types/error_code.json` | out_of_stock, item_unavailable, address_undeliverable, payment_failed | `int:error-codes` |
| Merchant-authoritative pricing | `checkout/index.md` (line item `item.price` is `omit` on requests) | `shopping/types/item.json`, `line_item.json` | pricing engine ignores client-sent prices | `unit:pricing-authority` |
| Totals array, minor units | `overview/index.md` (amounts), `checkout/index.md` → Total | `common/types/totals.json`, `total.json` | `merchant/pricing.ts` | `unit:totals` |
| Quantities & units (default `C62`/scale 0) | `overview/index.md` → Quantities and units | `common/types/quantity_unit.json` | whole-item catalog only; echoes default | `unit:quantity-identity` |
| Expiry (`expires_at`, 6h default) | `checkout/index.md`; schema description | `checkout.json#/properties/expires_at` | stored with TTL; expired → `canceled` | `unit:checkout-expiry` |
| Fulfillment extension | `shopping/extensions/fulfillment.md` | `schemas/shopping/fulfillment.json`, SDK `CheckoutWithFulfillment*Schema` | shipping destinations + 2 options | `int:fulfillment-select` |
| Discount extension | `shopping/extensions/discount.md` | `schemas/shopping/discount.json`, SDK `CheckoutWithDiscount*Schema` | codes `WELCOME10` (10%), `FLAT500` (₹500), automatic discount; rejected code message | `int:discount-apply`, `int:discount-rejected` |
| Idempotency (`Idempotency-Key`, 409 on payload mismatch) | `overview/index.md` → Error Codes; `signatures.md` → Replay Protection; REST OpenAPI params | OpenAPI `components.parameters.idempotency_key` | `persistence/idempotency.ts` keyed by `(platform, key)` with request hash | `int:idempotency-replay`, `int:idempotency-conflict-409` |
| `Request-Id` tracing | OpenAPI `request_id` parameter | — | correlation ID propagated to logs and inspector | `int:request-id-echo` |
| Rate limiting (429 + `Retry-After`) | `overview/index.md` → Protocol Errors | — | per-IP limiter on public routes | `int:rate-limit` |
| Payment handler advertisement | `overview/index.md` → Payment Architecture; `payment/guide.md` | `schemas/payment_handler.json` | custom handler `…mock_tokenizer` modeled on Processor Tokenizer | `int:handler-advertised-in-profile-and-response` |
| Payment instrument submission | `payment/tokenization.md`; `checkout/index.md` → Payments | `common/types/payment_instrument.json`, `token_credential.json`, `binding.json` | `payment.instruments[]` with `token` credential + `binding` | `int:payment-instrument-token` |
| Mock tokenizer `/tokenize` (binding replay guard) | `payment/tokenization.md` → Binding | `common/types/binding.json` | `POST /api/mock-psp/tokenize` — **SIMULATED**, accepts only published test PANs | `int:tokenize-binding-mismatch-rejected` |
| Payment failure / retry (`payment_failed`) | `checkout/index.md` → Standard Errors | `message_error.json` | deterministic test tokens: success, decline, insufficient_funds, async | `e2e:payment-failure-retry` |
| Buyer consent before completion | `checkout/index.md` Overview (trusted UI); `shopping/extensions/buyer-consent.md` | `schemas/shopping/buyer_consent.json` | Platform-side confirmation UI; consent artifact logged in inspector. Extension itself not advertised in v1 | `e2e:explicit-consent-required` |
| Order created from checkout | `shopping/order/index.md` → Overview | `schemas/shopping/order.json`, SDK `OrderSchema` | order built on completion | `int:order-created-on-complete` |
| Get order | `order/index.md` → Get Order; `order/rest.md` | `order.json` | `GET /api/ucp/v1/orders/{id}`; error `not_found` / `unauthorized` | `int:order-get`, `int:order-not-found` |
| Order authorization (platform credentials) | `order/index.md` → Authorization | — | `X-API-Key` issued to demo platform; orders scoped to originating platform | `int:order-authz` |
| Line item status derivation | `order/index.md` → Status Derivation | `shopping/types/order_line_item.json` | pure function | `unit:line-item-status` |
| Fulfillment expectations/events (append-only) | `order/index.md` → Fulfillment | `shopping/types/expectation.json`, `fulfillment_event.json` | admin console appends events | `unit:order-events-append-only` |
| Adjustments (refund/return/cancellation) | `order/index.md` → Adjustments | `shopping/types/adjustment.json` | admin console appends adjustments; **no platform-initiated cancel/return op (not in spec)** | `unit:adjustments` |
| Order webhook delivery | `order/index.md` → Order Event Webhook | `order.json` payload | Business → platform POST, full entity each time | `int:webhook-delivery` |
| Webhook headers `Webhook-Id`, `Webhook-Timestamp` | `order/index.md` → Required Headers | — | set by sender | `unit:webhook-headers` |
| Webhook signing (RFC 9421 + `Content-Digest` RFC 9530) | `order/index.md` → Signature Verification; `signatures.md` → REST Request Signing | — | `crypto/sign-request.ts`, `verify-request.ts` | `unit:rfc9421-vectors` (spec examples), `int:webhook-signature-ok` |
| Webhook authorization (signer profile = order's business) | `order/index.md` → Verification (Platform) | — | platform handler | `int:webhook-wrong-business-rejected` |
| Webhook idempotent processing (dedupe by `Webhook-Id`) | `order/index.md` Guidelines; Standard Webhooks | — | `platform/webhook-handler.ts` | `int:webhook-duplicate-noop` |
| Webhook retry | `order/index.md` → Guidelines (Business MUST retry) | — | queue table + retry endpoint triggered via Vercel Cron / manual replay | `int:webhook-retry` |
| REST auth (API key) | `checkout/rest.md` → Authentication | OpenAPI `x_api_key` | middleware | `int:auth-api-key` |
| Schema validation of every payload | `overview/index.md` → Resolution Flow step 6 | SDK Zod schemas; JSON Schema from `ucp-schema` for Module H | `validation/*` | `unit:validation-errors-have-paths` |
| Conformance run | `conformance` repo | — | `scripts/conformance.sh` against local server | `conf:*` (report in `docs/CONFORMANCE_REPORT.md`) |
| MCP transport | `checkout/mcp.md`, `overview/index.md` → Transport Layer | `services/shopping/mcp.openrpc.json` | **Not in v1** | — |
| A2A / Embedded transport | `checkout/a2a.md`, `embedded.md` | — | **Not in v1** | — |
| Identity linking | `common/identity-linking/index.md` | `common/identity_linking.json` | **Not in v1** | — |
| AP2 mandates | `payment/extensions/ap2-mandates.md` | `common/payment_ap2_mandate.json` | **Not implemented**; the UI will say so | — |

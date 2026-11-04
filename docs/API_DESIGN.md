# API Design

Three families of HTTP endpoints. **Only family 1 is UCP.** Paths, methods and payload shapes in family 1 are taken
from `source/services/shopping/rest.openapi.json` and the schemas in `UCP_SPECIFICATION_MAPPING.md`; they are not
invented. Families 2 and 3 are demo-specific and are labelled so in the UI.

## 1. UCP business endpoints (spec-defined)

Base: profile `services["dev.ucp.shopping"][transport=rest].endpoint` = `{PUBLIC_BASE_URL}/api/ucp/v1` (no trailing slash).

| Operation | Method & path | Success | Notable headers |
|---|---|---|---|
| Discovery | `GET /.well-known/ucp` (origin root, **not** under the endpoint) | 200 profile | `Cache-Control: public, max-age=300` |
| Catalog search | `POST /catalog/search` | 200 | `UCP-Agent`, `Request-Id` |
| Catalog lookup | `POST /catalog/lookup` | 200 | same |
| Get product | `POST /catalog/product` | 200 | same (defined in OpenAPI; optional in v1) |
| Create checkout | `POST /checkout-sessions` | 201 | `UCP-Agent`, `Request-Id` (uuid, required), `Idempotency-Key` (uuid, required) |
| Get checkout | `GET /checkout-sessions/{id}` | 200 | `UCP-Agent`, `Request-Id` |
| Update checkout | `PUT /checkout-sessions/{id}` | 200 (full replacement) | + `Idempotency-Key` |
| Complete checkout | `POST /checkout-sessions/{id}/complete` | 200 | + `Idempotency-Key` |
| Cancel checkout | `POST /checkout-sessions/{id}/cancel` | 200 | + `Idempotency-Key` |
| Get order | `GET /orders/{id}` | 200 | `UCP-Agent`, `Request-Id`, `X-API-Key` (platform credential) |

Common request headers: `UCP-Agent: profile="https://…/api/platform/profile"` (RFC 8941 dictionary),
`Content-Type: application/json`, `Accept: application/json`. Auth in the demo: `X-API-Key` for the platform
credential (spec: "optional and depends on business requirements"); catalog and discovery are open.

Response envelope (every business response): `ucp.version` = negotiated version; `ucp.capabilities` = only capabilities
active **and relevant** to the operation (checkout → checkout + active extensions; order → order);
`ucp.payment_handlers` on checkout responses. Error with no resource: `ucp.status:"error"`, `messages[]`, `continue_url`.

Error matrix (from `overview/index.md`):

| Condition | HTTP | Body `messages[0].code` |
|---|---|---|
| Missing/malformed `UCP-Agent` | 400 | `invalid_profile_url` |
| Platform profile fetch failed | 424 | `profile_unreachable` |
| Platform profile invalid | 422 | `profile_malformed` |
| Platform version unsupported | 422 | `version_unsupported` |
| No compatible capability for operation | 200 | `capabilities_incompatible` (`ucp.status:"error"`, `continue_url`) |
| Bad/missing credential | 401 / 403 | `unauthorized` / `forbidden` |
| `Idempotency-Key` reused, different payload | 409 | `idempotency_conflict` (code name is demo-chosen; spec fixes only the HTTP status) |
| Rate limited | 429 | `rate_limited` + `Retry-After` (demo-chosen code; spec fixes only the HTTP status) |
| Unknown checkout/order | 200/404 body with `not_found`, severity `unrecoverable` | per spec order example |
| Out of stock / unavailable | 200 | `out_of_stock`, `item_unavailable` |
| Payment failure | 200 | `payment_failed`, severity `recoverable` |

> **Implemented (M2):** `POST /catalog/product` is not implemented (optional). Cart routes exist only to return `capabilities_incompatible`. Checkout `404 not_found` and `409 invalid_state` are demo-chosen codes (non-normative).

> The status code for "not found" and for business errors that carry a resource follows the spec examples
> (`checkout/rest.md`, `order/index.md`). Where the spec fixes only the HTTP status or leaves the code open, the
> demo-chosen code is documented here and shown as such in the inspector ("non-normative").

### Platform-hosted UCP-related endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/platform/profile` | Platform profile (`platform_schema`): services, capabilities incl. `dev.ucp.shopping.order` with `config.webhook_url`, `keys[]` |
| `POST /api/platform/webhooks/orders/{platformId}` | Receives business order events (Standard Webhooks headers + RFC 9421 signature). The `platformId` path segment is how this single deployment tells demo platforms apart; the platform advertises it as `config.webhook_url`. Returns 2xx quickly; applies the snapshot afterwards via `after()` |

## 2. Simulated participants (demo-specific, not UCP)

| Endpoint | Purpose |
|---|---|
| `POST /api/mock-psp/tokenize` | Mock credential provider following the Processor Tokenizer *pattern*: body `{credential, binding:{type,id}, identity?}` → `{token, expires_at}`. Accepts published test PANs only; rejects anything else with a clear error and never logs the value. |
| (internal) `merchant → psp.charge(token)` | In-process port `PspPort` with the deterministic outcome table below |

Deterministic test credentials:

| Test credential (published test values) | Outcome |
|---|---|
| `4242 4242 4242 4242` | approved |
| `4000 0000 0000 0002` | declined → `payment_failed` |
| `4000 0000 0000 9995` | insufficient funds → `payment_failed` |
| `4000 0000 0000 3220` | requires async confirmation → `complete_in_progress`, resolved by next Get Checkout |

(Public Stripe-style test numbers are conventional but are **not** Stripe integrations; the UI says "simulated".)

## 3. Playground BFF (demo-specific)

All under `/api/playground/*`, JSON, session-cookie scoped, Zod-validated in/out.

| Endpoint | Purpose |
|---|---|
| `POST /session/reset` | Delete this session's data |
| `GET /agent` · `POST /agent/message` `{text}` or `{event:"authorization_attempted"}` · `POST /agent/profile` · `POST /agent/reset` | The rule-based agent. The event carries no result: the agent re-reads the checkout from the merchant |
| `POST /checkout/authorize` `{checkoutId, cardId, expectedTotal}` | One buyer click: consent bound to the shown total, then Complete. Never callable by the agent |
| `GET /scenarios` · `GET /scenarios/{id}` · `POST /scenarios/{id}/run` · `POST /scenarios/{id}/reset` | Guided scenarios; `run` executes the next step or, after a buyer step, verifies what the buyer did |
| `POST /discovery/fetch` `{origin}` | Run discovery for an allowlisted origin (SSRF-guarded); returns profile, binding report, negotiation |
| `POST /agent/message` `{text}` | Advance the agent; returns timeline events |
| `POST /agent/consent` `{checkoutId, lineItemsHash, total}` | Persist buyer consent produced by the confirmation UI |
| `GET  /inspector/events?actor=&op=&status=&q=&correlation=&limit=` | Interaction records (redacted, no session id) plus facets and a summary |
| `GET  /inspector/export` (same filters) | NDJSON download: a meta line, then one interaction per line |
| `POST /inspector/replay` `{id}` | Re-issue a recorded READ-ONLY platform request (`get_profile`, `get_checkout`, `get_order`, `search_catalog`, `lookup_catalog`) and compare. Everything else: 409 with the reason |
| `GET  /validator/targets` · `GET /validator/schema/{id}` · `POST /validator/validate` `{target, payload}` | Targets with examples and the op→target map; the official source schema; validation report (schema issues + spec-rule checks + scope note) |
| `GET /orders` | Merchant order dashboard data (business-internal) |
| `POST /orders/{id}/action` `{action}` | Merchant admin console: `ship`, `deliver`, `cancel`, `return`, `refund` (business-internal; each pushes a webhook) |
| `POST /webhooks/retry` | Deliver pending outbox rows now, ignoring the backoff schedule |
| `POST /webhooks/send` `{rowId, mode}` | `redeliver` (same Webhook-Id, a duplicate) or a security demo: `tamper_body`, `bad_signature`, `unknown_key`, `stale_timestamp`, `wrong_signer` |
| `GET /api/cron/webhooks` (outside `/api/playground`) | Retry driver for Vercel Cron; 404 unless `CRON_SECRET` is set; bearer-authenticated |
| `POST /scenarios/{id}/run` · `POST /scenarios/{id}/reset` | Scripted scenarios |
| `GET  /webhooks` | Business outbox rows, platform receipts and platform-side order snapshots |

## 4. Gated testing endpoint

`POST /testing/simulate-shipping/{orderId}` with header `Simulation-Secret` — required by the official conformance suite;
enabled only when `ENABLE_TESTING_ENDPOINTS=true`; 404 otherwise.

## 5. Shared validation and normalization

* `src/ucp/validate.ts` exposes `validateRequest(op, body, active)` / `validateResponse(op, body, active)`; used by merchant
  route handlers, the UCP client, the inspector's validation badge and Module H.
* `src/ucp/errors.ts` produces every error envelope (`toUcpError(kind, …)`), so shapes are uniform.
* Correlation: `Request-Id` is generated by the platform client (uuid v4); the merchant echoes it in the response header and
  logs; the inspector joins the platform-side and business-side records on it.

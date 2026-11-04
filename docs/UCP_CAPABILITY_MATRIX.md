# UCP Capability Matrix (release 2026-08-25)

Legend: **Planned (v1)** = will be implemented and tested; **Simulated** = demo participant with a real UCP-shaped
interface but fake backing system; **Not in v1** = deliberately out of scope; **N/A** = not part of this release.
Nothing is marked "Done" until it has a passing test (see `IMPLEMENTATION_PLAN.md`).

## Capabilities

| Capability / feature | Name in profile | Business (demo merchant) | Platform (demo agent) | Notes |
|---|---|---|---|---|
| Checkout | `dev.ucp.shopping.checkout` | Planned (v1) | Planned (v1) | REST only |
| Fulfillment (extension) | `dev.ucp.shopping.fulfillment` | Planned (v1) | Planned (v1) | extends checkout |
| Discount (extension) | `dev.ucp.shopping.discount` | Planned (v1) | Planned (v1) | codes + one automatic discount |
| Order | `dev.ucp.shopping.order` | Planned (v1) | Planned (v1) | Get Order + signed webhooks |
| Catalog search | `dev.ucp.shopping.catalog.search` | Planned (v1) | Planned (v1) | used by the agent for product discovery |
| Catalog lookup | `dev.ucp.shopping.catalog.lookup` | Planned (v1) | Planned (v1) | |
| Cart | `dev.ucp.shopping.cart` | Not in v1 | Not in v1 | agent goes catalog → checkout directly |
| Buyer consent (extension) | `dev.ucp.shopping.buyer_consent` | Not in v1 | UI-level consent only | UI consent ≠ the extension |
| Permalink | `dev.ucp.shopping.permalink` | Not in v1 | — | |
| Identity linking | `dev.ucp.common.identity_linking` | Not in v1 | Not in v1 | demo uses API-key platform credentials |
| Location search/lookup | `dev.ucp.common.location.*` | Not in v1 | — | |
| Payment terms / split payments | `dev.ucp.common.payment.*` | Not in v1 | — | |
| Loyalty | `dev.ucp.common.loyalty` (extension) | Not in v1 | — | |
| AP2 mandates | payment extension | **Not implemented** | **Not implemented** | no cryptographic payment authorization is claimed anywhere in the UI |
| Lodging booking | (draft spec; name not verified) | N/A (draft) | N/A | draft spec, excluded by the version pin |

## Transports

| Transport | Business | Platform | Notes |
|---|---|---|---|
| REST | Planned (v1) | Planned (v1) | primary |
| MCP | Not in v1 | Not in v1 | spec defines `services/shopping/mcp.openrpc.json`; candidate for v2. Never described as "UCP" in the UI. |
| A2A | Not in v1 | Not in v1 | official sample is marked unmaintained |
| Embedded | Not in v1 | Not in v1 | |

## Payment handler (demo-defined)

| Handler | Status | Notes |
|---|---|---|
| Custom `mock_tokenizer` (pattern: Processor Tokenizer example) | **Simulated** | Accepts only published test credentials, never real PAN/CVV/bank data. Advertised under a namespace controlled by the deployment (see deviations). |
| `com.google.pay`, `dev.shopify.shop_pay` | Not in v1 | Appear only in the spec's example text; no integration. |

## Security mechanisms

| Mechanism | Status |
|---|---|
| Profile `keys[]` publication | Planned (v1) |
| Webhook signing/verification (RFC 9421 + RFC 9530 digest), ES256 default, EdDSA optional | **Implemented (M3)**, real cryptography with demo keys |
| REST request signing (platform → business) | Not in v1 (API key auth instead); signature headers documented, not required (spec: auth is optional) |
| Authority binding validator | Planned (v1) as a platform-side validator + inspector panel |
| Idempotency keys | Planned (v1) |
| Rate limiting | Planned (v1) |
| SSRF-safe fetch | Planned (v1) |

## Known and anticipated deviations from the spec

Each must be repeated in the README and shown in the UI "Spec Fidelity" panel.

1. **Authority binding for the demo's own entities.** Spec: `localhost` and single-label hosts are invalid authorities;
   `vercel.app` is a public suffix the spec advises against. A custom handler/extension therefore cannot be
   spec-valid when hosted on `*.vercel.app` or `localhost`. Plan: the handler name derives from `UCP_NAMESPACE`
   (e.g. `com.yourdomain.mock_tokenizer` when a custom domain is configured). With no custom domain the platform
   validator marks the handler `binding: relaxed (demo)` and says so. `dev.ucp.*` entities always bind to `ucp.dev`.
2. **HTTPS/TLS 1.3.** Local development runs over `http://localhost`. Vercel terminates TLS (TLS 1.3 supported); the
   app cannot assert the negotiated TLS version.
3. **Platform profile `UCP-Agent` URL on loopback.** Platform and business live in one deployment; the business
   fetches the platform profile from the same origin via the guarded fetcher with an explicit demo allowlist.
4. **Extra demo merchants.** `/.well-known/ucp` is the single canonical profile. Failure-mode merchants
   (unsupported capability, incompatible version) are served under `/demo-merchants/{slug}/…` and are *labelled as
   fixtures*, not as additional well-known profiles.
5. **Testing endpoint.** `/testing/simulate-shipping/{order_id}` (needed by the official conformance suite) is not in
   UCP; secret-guarded and disabled unless `ENABLE_TESTING_ENDPOINTS=true`.
6. **Real cryptography with public demo keys.** Webhook signatures are genuine; the key pair is a throwaway demo key,
   not a production trust anchor.

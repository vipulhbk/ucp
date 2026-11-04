# Security Design

Scope: a public demo with **no real payments or real personal data**. Controls below are real where marked
*implemented-in-demo* and explicitly simulated otherwise. No claim of PCI, AP2, or UCP certification is made.

## 1. Threat model (STRIDE-lite)

| Threat | Surface | Control |
|---|---|---|
| SSRF via discovery / platform-profile fetch / schema fetch / webhook URL | `/api/playground/discovery/fetch`, merchant fetching `UCP-Agent` profile, webhook sender | One `safeFetch`: https only (http allowed solely for `localhost` when `NODE_ENV!=production`), no userinfo, DNS-resolve then deny private/loopback/link-local/metadata ranges (IPv4+IPv6), pin resolved IP for the connection, `redirect:'manual'` (spec: MUST NOT follow redirects for `schema`/profile), 5 s timeout, 256 KB body cap, **demo origin allowlist** |
| Authority-binding bypass (`https://ucp.dev@evil/…`, `com.examplecorp` vs `com.example`) | profile/schema URLs | Spec algorithm implemented with all 9 table vectors + userinfo, IP-literal, single-label, punycode, trailing-dot vectors as tests |
| Tampered / forged webhooks | `/api/platform/webhooks/orders` | RFC 9530 digest check, RFC 9421 signature with key from signer's profile `keys[]`, signer-profile = order's business check, timestamp window ±5 min, `Webhook-Id` dedupe (`SET NX`) |
| Replay of state-changing calls | UCP endpoints | `Idempotency-Key` + request hash; 409 on mismatch |
| Price tampering | checkout create/update | Merchant-authoritative pricing; client price fields ignored; test with inflated/negative client values |
| Completion without consent | Complete path in the platform | Consent record (checkoutId, lineItemsHash, total, handler) must exist and match the *current* totals; otherwise the platform refuses to call Complete |
| Real card data entry | payment simulator UI & `/tokenize` | Only published test credentials accepted; input is rejected server-side (Luhn-valid non-test PANs rejected), never persisted/logged; UI banner "SIMULATED" |
| Secrets in browser/logs | everywhere | Server-only env; `NEXT_PUBLIC_*` limited to non-secret base URL; `server-only` import guard on key modules; redaction in recorder |
| Cross-visitor data access | storage | Session-namespaced keys derived from an unguessable HttpOnly, `SameSite=Lax`, `Secure` cookie; platform API key derived by HMAC per session |
| Abuse / cost | public endpoints | Per-IP + per-session rate limits (Upstash sliding window or in-memory fallback), body size limit 64 KB, TTL on all data, bounded log length |
| XSS via rendered JSON/markdown | inspector, docs | JSON rendered as text tokens (no `dangerouslySetInnerHTML`), markdown sanitized, CSP header |
| Open testing endpoint | `/testing/*` | Env-gated + constant-time secret compare; returns 404 when disabled |
| Dependency risk | supply chain | Pin `@ucp-js/sdk` exactly; lockfile; `npm audit` in CI |

## 2. Authentication and authorization

* Spec: authentication is optional, business policy. Demo business policy: open for discovery + catalog; `X-API-Key`
  platform credential for checkout/order. Orders and checkouts are visible only to the originating platform credential
  (spec: "Platform credentials → Orders originated by the platform").
* Playground BFF routes authorize by the session cookie; admin console actions are limited to that session's own orders.
* No user accounts, no OAuth/identity linking in v1.

## 3. Cryptography (implemented-in-demo)

* Merchant signing key: **ES256 (ECDSA P-256)**, the spec's universal verification baseline, published in profile `keys[]`
  with `kid` = RFC 7638 JWK thumbprint. Ed25519 (`EdDSA`, optional in the spec) is implemented for both signing and verifying and
  covered by tests, but is not the default. Signatures use raw `r||s` encoding (never DER) and are cross-checked in tests against an
  independent RFC 9421 implementation (`http-message-signatures`) in both directions.
* Signing/verification per `signatures.md` REST algorithm: covered components for webhooks are
  `"@method" "@authority" "@path" "ucp-agent" "content-digest" "content-type" "webhook-id" "webhook-timestamp"`
  (the last two are an application policy beyond the spec minimum, so an attacker cannot swap the event id or timestamp); `created`/`expires` parameters set;
  verifier ignores unknown keys/algs.
* Private key from `MERCHANT_SIGNING_JWK` (server env). `scripts/gen-keys.ts` creates a throwaway key. In deterministic
  mode a fixed **demo-only** key is used and the app logs a warning; production deployments **refuse to boot** with the
  deterministic key unless `ALLOW_DEMO_KEY=true`.
* All demo keys are public-knowledge-grade; they prove mechanism, not trust.

## 4. Data handling

| Data | Handling |
|---|---|
| Buyer name/email/phone/address | Synthetic defaults prefilled; user-typed values accepted, stored 24 h under session key, masked in inspector (`j***@example.com`) and in exports |
| Payment | Only test PAN input; tokenizer stores `token → test-card-id` mapping; raw PAN never stored |
| API keys / Authorization / Signature private material / tokens | Redacted (`[REDACTED]`) in all logs and the inspector; `Signature` *header values* are shown (public, needed to explain verification) |
| IP addresses | Used only for rate limiting, hashed |

## 5. Transport and browser hardening

HTTPS enforced by Vercel (HSTS header set). Security headers: CSP (default-src 'self'; connect-src 'self'), `X-Content-Type-Options`,
`Referrer-Policy: same-origin`, `X-Frame-Options: DENY` except the architecture diagram needs none. CORS: UCP endpoints
allow no browser origins by default (server-to-server); BFF is same-origin only.

## 6. Limitations of the simulated security components (to be shown in-app and in README)

1. Mock tokenizer/PSP provide no real tokenization security or fraud controls.
2. Platform and business share a deployment and a trust root; real deployments separate them.
3. Platform API key is derived from the session cookie; real credentials are provisioned out of band.
4. No mTLS, OAuth, or RFC 9421 *request* signing from platform → business in v1.
5. No AP2 mandates; checkout completion relies on a trusted-UI consent step only, which is the spec's non-AP2 path.
6. The consent UI is part of the same web app as the agent; a production trusted UI must be isolated from the agent.
7. Demo signing keys are not secret-grade; webhook verification demonstrates the algorithm, not key custody.
8. Rate limiting and SSRF protections are best-effort on a serverless platform.

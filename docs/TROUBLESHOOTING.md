# Troubleshooting

## The app will not start on Vercel: "MemoryStore is not safe on Vercel"

Serverless instances do not share memory, so the in-memory store would silently lose data. Configure Redis (the Upstash integration; see
`.env.example`), or set `ALLOW_MEMORY_STORE=true` for a throwaway preview.

## "SERVER_SECRET must be set in production" or "MERCHANT_SIGNING_JWK is not set"

Production builds refuse to run with development defaults. Set `SERVER_SECRET`, and either `MERCHANT_SIGNING_JWK` (run `npm run keys:generate`)
or `ALLOW_DEMO_KEY=true` to publish the public demo key.

## Discovery fails

The Merchant Discovery page shows why. Common causes, all deliberate demos:

| You see | Meaning |
|---|---|
| `version_unsupported` | The selected platform fixture speaks only `2026-01-11`; the business offers `2026-08-25` |
| a capability missing under "Excluded" | No mutually supported version, or its parent extension is missing |
| `relaxed` under authority binding | Expected on `localhost` and `*.vercel.app`: they cannot be spec-valid authorities. Documented deviation, never silent |
| `origin_not_allowlisted` | The platform may only contact the demo origins (SSRF protection). Add more with `DEMO_MERCHANT_ORIGINS` |

## A checkout cannot be completed

* **"The buyer has not authorized this purchase"**: Complete is impossible without your click on the confirmation card. This is by design.
* **"The total changed from what you were shown"**: the checkout changed after you reviewed it. Review again.
* **Consent expired or already used**: authorization is single-use and lasts ten minutes.
* **Status `requires_escalation`**: the order is above ₹50,000, or the platform fixture lacks the fulfillment extension, so the API cannot finish it; the response carries a `continue_url`.
* **`payment_failed`**: you chose a decline card on purpose, or it was a typo. Update the checkout and authorize a different card.
* **A real card number is refused**: always. Only the published test cards work, and entered numbers are never stored or logged.

## 429 Too Many Requests

The business rate-limits per client address and minute (default 300; `UCP_RATE_LIMIT_PER_MIN`). The response carries `Retry-After`.

## Webhooks stay "pending"

Delivery runs after the response. Use **Retry pending now** in the Webhook Inspector. Retries back off from 5 seconds to 1 hour and stop after 6 attempts. A Vercel Hobby plan runs cron at most daily (`CRON_SECRET` enables the route).

## A webhook was rejected

Open the Webhook Inspector: each receipt carries the reason (`digest_mismatch`, `signature_invalid`, `key_not_found`, `webhook_timestamp_invalid`, `signer_not_order_business`, `unknown_order`). The security demos produce each one on purpose.

## Replay says "not replayable"

Only read-only platform requests are replayed from the (redacted) log. State-changing calls cannot be reproduced faithfully from a redacted log; use the Checkout Playground's "Replay last call (same key)".

## Port 3000 is busy

Run `npm run dev -- -p 3001` and set `PUBLIC_BASE_URL=http://localhost:3001` if you set it at all.

## Everything is stuck or confusing

**New conversation (reset session)** on the AI Agent page, or **Reset scenario**, deletes everything this session created.

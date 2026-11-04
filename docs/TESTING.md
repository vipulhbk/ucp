# Testing

```bash
npm run check        # typecheck + lint + every test (what to run before committing)
npm test             # all tests once
npm run test:watch   # watch mode
npm run typecheck    # next typegen + tsc --noEmit
npm run lint         # includes the layering rules (the protocol core and platform may not import merchant code)
npm run build        # production build
```

No test needs network access, a database, or credentials: the suite starts real HTTP servers on random local ports and uses the
in-memory store. Run `npm test` for the current counts rather than trusting a number written here.

## Layers

| Layer | Where | What it proves |
|---|---|---|
| Unit | `tests/unit` | Authority binding (the spec's table plus hardening), negotiation and intersection, `UCP-Agent` parsing, SSRF address policy, safe fetch, checkout state machine, pricing and discounts, catalog search, simulated PSP and tokenizer, consent gate, RFC 9421 sign/verify (including **interop with an independent implementation**), intent parsing, redaction, validator, architecture-data consistency, docs |
| Integration | `tests/integration` | Real HTTP between the platform and the business: discovery, negotiation errors, catalog, the full checkout lifecycle, idempotency, payment failure and retry, async completion, orders, signed webhooks (tamper, replay, wrong signer, out of order), the playground endpoints, the agent, all seven scenarios, the inspector (filters, export, replay, redaction), validator endpoints |
| Component | `tests/components` | The interactive pieces of the UI (diagram, tour, confirmation card, JSON viewer, docs renderer) in a simulated DOM |

## What the tests do not prove

* **Protocol conformance.** The official conformance suite has not been run; see `CONFORMANCE_REPORT.md` once it exists. Tests here check this project's own behavior against the specification as read, not against the official suite.
* **Real Redis.** Every test uses the in-memory store. The Redis adapter is written but unverified against a real server.
* **Real browsers.** No Playwright tests yet. The UI has been exercised by hand in a browser and by the component tests above, which do not replace end-to-end tests.
* **Deployment.** Nothing has been deployed to Vercel.

## Useful patterns when writing tests

* `tests/integration/env.ts` starts the app's route handlers over a real socket and gives you a `TestPlatform` (headers, API key, checkout helpers) and a cookie-keeping `Browser` for the playground endpoints.
* Webhook delivery and the receiver's processing run "after the response". Tests capture that work with `captureDeferred()` and decide when to `drain()` it, so ordering is deterministic.
* Use a fresh platform or browser per test: all data is namespaced per demo session.

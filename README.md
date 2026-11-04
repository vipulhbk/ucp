# UCP Playground

An interactive, inspectable demonstration of Google's **Universal Commerce Protocol (UCP)**, pinned to release **`2026-08-25`**.
A real UCP business (the demo merchant) and a platform (the simulated shopping agent) talk over real HTTP; every request
is meant to be visible in the Protocol Inspector. Payments, the credential provider and the agent are **simulated** and
labelled that way. No real card data is ever accepted. This is a demonstration, **not** a certified UCP implementation.

## Status

| Milestone | State |
|---|---|
| M0 Research and design docs | done (`docs/`) |
| M1 Foundation: discovery, negotiation, authority binding, safe fetch, persistence | **done, tested** |
| M2 Catalog, checkout (fulfillment + discount), idempotency, simulated payments, consent, Get Order | **done, tested** (244 tests) |
| M3 Order events + adjustments, merchant admin console, RFC 9421 signed webhooks, outbox/retry, verifying receiver | **done, tested** (304 tests) |
| M4 Rule-based shopping agent with activity timeline, seven guided scenarios, consent bound to the shown total | **done, tested** (369 tests) |
| M5 Protocol Inspector (filters, replay of read-only calls, NDJSON export, both webhook ends) and Schema Validator (10 message types, rule checks, scope statement) | **done, tested** (456 tests) |
| M6 UI polish: overview with spec-fidelity panel, interactive architecture diagram + guided tour, in-app docs viewer, loading/error states, responsive and theme audit | **done, tested** (581 tests; responsive/theme checks were manual) |
| Tiket AI Trips (`/trips`): Apple-style consumer front end, eight ready-made trips, rule-based mock planner (no AI model), booking through real UCP checkout | **done, tested** (see `docs/TRIPS.md`) |
| M7 Conformance + Playwright · M8 Vercel | not started |

Not deployed to Vercel. See `docs/IMPLEMENTATION_PLAN.md` for the checklist with evidence.

## Run locally

```bash
npm install
npm run dev            # http://localhost:3000  (in-memory store, demo signing key)
npm run check          # typecheck + lint + tests
npm run build
```

Try it: open **Merchant Discovery**, then **Checkout Playground** (create → update → review → authorize → complete), or `curl http://localhost:3000/.well-known/ucp`.

Open the **Protocol Inspector** to see every request and both ends of every webhook, or the **Schema Validator** to break a payload on purpose.

Try **Tiket AI Trips** (`/trips`): pick a ready-made trip, see the itinerary and book it through UCP.

Try the **AI Agent** (“Find me a wireless headphone under ₹5,000 with noise cancellation.”) or walk through **Guided Scenarios**.

After a purchase, open **Order Management** (ship it) and **Webhook Inspector** (see the signed delivery, then try the security demos).

Known gaps: Redis storage untested against a real Redis; no browser (Playwright) tests or official conformance run yet, so UI behavior has been verified only by hand; platform→business request signing not implemented.

## Pinned versions

* UCP spec release `2026-08-25` (tag `v2026-08-25`, commit `87dd4b1`).
* Official generated Zod schemas vendored from `js-sdk` 0.6.0 @ `3a86b3a` in `src/vendor/ucp-sdk/` (see `PROVENANCE.md` for why not npm 0.5.1).
* Next.js 16.4.5, React 19, Zod 3, Vitest 4.

## Docs

`docs/UCP_RESEARCH.md` · `UCP_SPECIFICATION_MAPPING.md` · `UCP_CAPABILITY_MATRIX.md` (incl. known deviations) · `UCP_GLOSSARY.md` ·
`PRD.md` · `SDD.md` · `ARCHITECTURE.md` · `API_DESIGN.md` · `SECURITY_DESIGN.md` · `SCENARIOS.md` · `TRIPS.md` · `TESTING.md` · `TROUBLESHOOTING.md` · `IMPLEMENTATION_PLAN.md`

All of them are also readable inside the app at `/docs`.

Configuration: `.env.example`.

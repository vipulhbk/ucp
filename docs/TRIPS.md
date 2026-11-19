# AI Trips (trip planner demo)

A consumer-style front end (`/trips`) on top of the UCP demo: plan a trip from a short form or pick one of eight ready-made
itineraries, then book it through the protocol against the simulated merchant. It reuses the existing platform, merchant,
consent and inspector code; it adds content, a planner interface and a booking route.

## What is real, simulated, and not claimed

| Part | Status |
|---|---|
| Itineraries | **Hand-written sample content.** Places are well-known landmarks and areas; costs are rough per-person estimates for illustration. No opening hours, fares or availability are claimed. |
| Planner | **Gemini when `GEMINI_API_KEY` is set, otherwise a rule-based mock with no AI model.** Every result names its author (`source.kind` is `"model"` or `"mock"`), and a fallback to the mock says why. See *Planning with Gemini* below. |
| Booking | **Real UCP calls** (Create Checkout, Update Checkout, then Complete after the buyer's authorization) from the demo platform to the demo merchant over HTTP, all visible in the Protocol Inspector. |
| Merchant, packages, payment | **Simulated.** Packages are fictional digital vouchers; the card is a published test card; nothing is reserved and no money moves. |
| Travel in UCP | **Not claimed.** The pinned release (`2026-08-25`) has no travel or lodging capability (the lodging spec is a draft, excluded by the version pin). Trips are modelled as ordinary catalog items under `Travel > Stays` and `Travel > Experiences`. |

## How a trip becomes a checkout

Each trip lists `bookables`: merchant catalog variant ids (`var_stay_<trip>`, `var_pass_<trip>`). `POST /api/playground/trips/book`
creates a checkout with those variants and then updates it (a full replacement) with the traveller's name and email. The merchant
prices everything itself: an automatic 5% discount applies at ₹15,000 and 18% GST on top. The page shows a preview, but the
checkout is authoritative, and the payment confirmation shows the merchant's total.

Paying is a separate buyer click on the shared confirmation card, which re-reads the checkout and sends the amount it showed;
the server refuses if the live total differs. The booking route cannot complete a checkout.

### Digital items skip shipping

The merchant's catalog has a `digital` flag. When every line of a checkout is digital, the merchant returns no `fulfillment`
block and asks for no shipping address or option. A cart that mixes a digital voucher with physical goods still requires
shipping for the whole order (tested). Ordinary electronics checkouts are unchanged (tested).

## Planning with Gemini

Set `GEMINI_API_KEY` (a Google AI Studio key) in `.env.local` or the Vercel environment and the planner is Google's Gemini.
The key is read on the server only and sent in the `x-goog-api-key` header; the browser never sees it, and
`GET /api/playground/trips/planner` reports only `{ mode, model }`.

| Setting | Meaning |
|---|---|
| `GEMINI_API_KEY` | Enables Gemini. Unset: the rule-based mock plans. |
| `GEMINI_MODEL` | Model id; default `gemini-3.5-flash-lite` (free tier on the pricing page when this was written). |
| `TRIP_PLANNER=mock` | Forces the mock even with a key set. |
| `GEMINI_PLANS_PER_HOUR` | Per-visitor allowance, default 10. Best effort: held in one server instance's memory, so on serverless hosting it is per instance and clearing cookies resets it. |

How it works (`src/trips/gemini.ts`, `src/app-services/trip-planner.ts`):

* One `generateContent` call with a system instruction and `responseMimeType: application/json` plus a JSON schema. What the
  traveller typed goes into the user message as a JSON object and the system instruction says to treat it as data, never as
  instructions. That reduces prompt injection; it does not remove it.
* The model's output is untrusted. It is parsed against `GeneratedItinerarySchema` (length-capped, 1–7 days, costs rounded) and
  rendered as plain text, so markup in it is shown, not run. Anything that fails validation counts as a failed call.
* On any failure (rate limit, rejected key, timeout, block, bad JSON, schema failure) or over the hourly allowance, the
  rule-based mock answers instead and the first caveat says why. The error body is discarded, so nothing from Google can leak
  into a message.
* **Origin and stays.** The form asks where the traveller is setting off from (optional). Gemini uses it for a short "getting there"
  note and returns three stay options across budget bands (name, kind, area, rough nightly price, why). Stay names are the model's
  suggestions: the prompt asks for well-known properties it is confident exist, or an honest description of a kind of place in a real
  neighbourhood, and never addresses, ratings or availability. The page says they are not checked against live availability and cannot
  be booked here (only the ready-made trips can). A plan without stay options fails validation and falls back to the mock. The mock
  planner only notes the origin in its caveats; the stay in a ready-made trip is the package that can be booked.
* A generated itinerary has nothing in the merchant catalog and cannot be booked. The result links the **closest ready-made trip**
  and says plainly when it is a different destination. Only the eight ready-made trips are bookable.

Honest limits:

* **No web search.** Grounding with Google Search is not available on the free tier, so Gemini plans from its own knowledge.
  Opening hours, prices and availability are not checked and the plan says so. "Search" here means typing any destination.
* **Privacy.** On the free tier Google says it may use prompts to improve its products. The form states, before the traveller
  presses Plan, that destination, interests, budget and notes are sent to Google, and asks them not to type personal details.
* **Not yet exercised against the live API in this repository's tests.** The tests stub Google's endpoint. The request fields were
  checked to parse (an invalid key reaches the key check), but a real plan has to be run once with a real key (the smoke test under *Tests*).
* Uses `generateContent`. Google's current docs lead with a newer `interactions` endpoint; `generateContent` still exists and
  works, and the call is isolated in one method if it needs to move.

## The /trips page

* **Planner.** Three steps: where (type a destination, tap a popular pick, or "Surprise me"), about you (interests with icons, a budget
  control, notes, and a live preview of the closest ready-made trip), and the result. The page never names the AI provider or model; it
  says "AI-written plan" or "Rule-based demo planner (no AI model)", and, before anything is sent, that the text goes to an AI service.
  The ranking used for the preview lives in `src/trips/rank.ts` (no sample data), so the browser can run it without every itinerary.
* **Result.** For the demo planner: cover, price, why this trip, days at a glance, two other trips. For an AI plan: the written itinerary,
  how it was planned, caveats, and a link to the closest bookable trip.
* **Below the planner:** "How it works", then the ready-made shelf with interest filters and "Surprise me".

## Design

The trips pages use an Apple-style design language, scoped to the `(trips)` route group (`src/app/(trips)/apple.css`) by
re-pointing the shadcn design tokens inside `.apple`: SF system font stack (not bundled; falls back off Apple devices), light gray
page with white rounded cards, true black in dark mode, a frosted translucent nav, large tight-tracking headlines, pill buttons in
system blue, a segmented budget control and hairline borders. The protocol dashboard keeps its own look. Reduced-motion is honoured.

## Tests

| File | Covers |
|---|---|
| `tests/unit/trips.test.ts` | Data contract for all eight trips (schema, day numbering, cover exists, every interest reachable, bookables are real digital variants with stock, total under the merchant's review limit) and the planner (determinism, destination and interest ranking, budget, "avoid night life", honest caveats, validation) |
| `tests/integration/trips.test.ts` | Over real HTTP, for every trip: Create + Update, merchant-priced total equals the merchant's own pricing, no fulfillment, consent mismatch refused, completion, order retrieval; declined card; request validation; mixed cart still needs shipping; electronics unchanged; trips searchable through the UCP catalog |
| `tests/unit/gemini.test.ts` | Request shape (key only in a header, schema-bound JSON, user text kept out of the system instruction), result mapping, twelve failure modes with no key leakage, fallback labelling |
| `tests/integration/trips.test.ts` (Gemini block) | Planner info route never returns the key, model-labelled plan over the real server with Google stubbed, fallback on 429, `TRIP_PLANNER=mock`, hourly allowance |
| `tests/components/planner-flow.test.tsx` | Three-step flow sends exactly what was entered, labels the planner a mock, interest limit of three, caveats shown, error handling, start over; trip card |

Live smoke test with a real key (run locally; the key stays in your gitignored `.env.local`, never in the repo or a chat):

```bash
npm run dev    # in one terminal, with GEMINI_API_KEY in .env.local
curl -s localhost:3000/api/playground/trips/plan -H 'content-type: application/json' -d '{"destination":"Tokyo","interests":["art"],"notes":"4 days"}' | head -c 600
```

A good run returns `"source":{"kind":"model",...}` and a `generated` itinerary; a bad key, quota or model name returns
`"source":{"kind":"mock"}` with the reason as the first caveat.

## Known gaps

* Cover art is generated illustration, not photography; the page says it is decorative.
* The mock planner understands a handful of keywords, not natural language, and cannot resize a trip or invent one. Gemini can, but cannot make its plan bookable.
* Only the stay and experience pass are bookable: no flights, transfers or multi-room options.
* Responsive and theme checks were manual (one phone width, one desktop width, light and dark); there are no Playwright tests yet.

# AI Trips (trip planner demo)

A consumer-style front end (`/trips`) on top of the UCP demo: plan a trip from a short form or pick one of eight ready-made
itineraries, then book it through the protocol against the simulated merchant. It reuses the existing platform, merchant,
consent and inspector code; it adds content, a planner interface and a booking route.

## What is real, simulated, and not claimed

| Part | Status |
|---|---|
| Itineraries | **Hand-written sample content.** Places are well-known landmarks and areas; costs are rough per-person estimates for illustration. No opening hours, fares or availability are claimed. |
| Planner | **A rule-based demo planner with no AI model.** It ranks the eight itineraries and says why; every result names its author (`source.name`). It sits behind the `TripPlanner` interface, so a model-backed planner can replace it. |
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

## How the planner works

`MockTripPlanner` (`src/trips/planner.ts`) scores each ready-made trip against what the traveller chose (destination words, up to three
interests, a budget band, a few keywords in the notes) and returns the best one with the reasons and the things it could not honour.
It has no model, no network and no randomness. The scoring lives in `src/trips/rank.ts`, which imports no sample data, so the planner
form ranks a slim list of trips in the browser to preview "Best match so far" as the traveller chooses. The result itself always
comes from `POST /api/playground/trips/plan`.

## The /trips page

* **Hero and planner.** Three steps: where (type a destination, tap a popular pick, or "Surprise me"), about you (interests with icons,
  a budget control, optional notes, and a live best-match preview), and the result (cover, price, why this trip, the days at a glance, two
  other trips worth a look).
* **How it works** in three steps, then the **ready-made trips** shelf with interest filters and a "Surprise me" button.

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
| `tests/components/planner-flow.test.tsx` | Three-step flow sends exactly what was entered and labels the planner a mock, popular picks and "Surprise me", live best-match preview, result price / days / alternatives, interest limit of three, caveats, error handling, start over; trip card |

## Known gaps

* Cover art is generated illustration, not photography; the page says it is decorative.
* The mock planner understands a handful of keywords, not natural language, and cannot resize a trip or invent one.
* Only the stay and experience pass are bookable: no flights, transfers or multi-room options.
* Responsive and theme checks were manual (one phone width, one desktop width, light and dark); there are no Playwright tests yet.

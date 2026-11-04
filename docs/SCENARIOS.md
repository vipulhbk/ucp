# Guided Scenarios

Seven walkthroughs, each independently runnable and resettable, in the app under **Guided Scenarios**. Every step states what the
specification says happens, then performs it for real against the demo merchant and shows the actual request and response. A scenario
step never authorizes spending for you: steps marked **buyer** prepare a confirmation and wait for your click, then check what happened
by asking the merchant (a forged "done" cannot advance a scenario).

Reset deletes this demo session's data on both the platform and the business side; other visitors are unaffected.

Step ids below are the ids the app uses (and a test keeps this document in sync with the code).

## 1. Merchant discovery (`merchant-discovery`)

How a platform finds a business, reads what it supports, and decides what it can use.

| Step | What happens | Protocol |
|---|---|---|
| `request` | The agent requests discovery | `GET /.well-known/ucp`; the profile is validated against the official schema |
| `profile` | The merchant returns its profile; the agent reads the supported services | `services["dev.ucp.shopping"]`, transport `rest`, `endpoint` resolved from the profile, never hardcoded |
| `capabilities` | The agent discovers the checkout capability and its extensions | Authority binding of each schema URL, exact-version intersection, orphan-extension pruning |
| `handlers` | The agent determines the payment handlers | `payment_handlers` (the demo handler is labelled simulated) |

## 2. Successful purchase (`successful-purchase`)

Request → search → checkout → price → explicit buyer authorization → order. Payment is simulated.

| Step | What happens | Protocol |
|---|---|---|
| `request` | The shopper submits a product request | Platform-internal: natural language to search parameters, by deterministic rules |
| `search` | The agent searches the catalog | `POST /catalog/search` with a price filter in minor units |
| `select` | The agent selects a product | Platform-internal: best rated product that meets every requirement |
| `create` | The agent creates a checkout | `POST /checkout-sessions` with item ids and quantities only; prices are never sent |
| `session` | The merchant returns the session | `status`, recoverable `messages[]` with JSON paths, `totals`, `expires_at`, payment handlers |
| `update` | The agent updates quantities, buyer and address | `PUT /checkout-sessions/{id}`: a full replacement |
| `price` | The merchant calculates the final price | `totals[]` recomputed by the business |
| `authorize` (**buyer**) | You review and explicitly authorize | The trusted-UI step. The platform tokenizes the test card and calls `POST …/complete` with a token credential |
| `complete` | The merchant completes the checkout | `status: completed` with `order {id, permalink_url}` |
| `order` | The merchant creates the order | `GET /orders/{id}`: the full current-state snapshot |
| `result` | The agent receives the result | Later updates arrive as signed webhooks |

The brief's "shopper reviews" and "shopper explicitly authorizes" are one buyer step because they are one interaction.

## 3. Unsupported capability (`unsupported-capability`)

The platform asks for something the business does not offer, receives the specified error, and recovers.

| Step | What happens | Protocol |
|---|---|---|
| `discover` | The agent discovers capabilities | The platform fixture also advertises `dev.ucp.shopping.cart`, which the business does not |
| `request` | The agent requests the unsupported capability | `POST /carts`. A well-behaved agent would not; this step does it deliberately (the chat agent refuses and says why) |
| `error` | The merchant returns the appropriate error | `capabilities_incompatible`: HTTP 200 with `ucp.status: "error"`, `messages[]` and a `continue_url` |
| `recover` | The agent handles the failure gracefully | Falls back to creating a checkout through a capability both sides support |

## 4. Payment failure and retry (`payment-failure`)

| Step | What happens | Protocol |
|---|---|---|
| `create` | The agent creates a checkout and brings it to `ready_for_complete` | `POST` then `PUT` until the business says so |
| `decline` (**buyer**) | You choose the declined test card and authorize | Tokenize, then `POST …/complete` |
| `failure` | The payment simulator returns a failure | Not an HTTP error: `200`, `status: incomplete`, recoverable `payment_failed` at `$.payment.instruments[0]` |
| `display` | The agent shows the error and resolves it through Update | The failed instrument is cleared; the checkout returns to `ready_for_complete` |
| `retry` (**buyer**) | You retry with another card | Fresh consent, fresh tokenization, fresh `Idempotency-Key` |
| `success` | The transaction succeeds | `GET /orders/{id}`; exactly one order exists |

If you pick an approved card in the `decline` step, the step reports that and asks you to reset.

## 5. Order lifecycle (`order-lifecycle`)

The business ships an order; a signed webhook carries the new state to the platform.

| Step | What happens | Protocol |
|---|---|---|
| `created` (**buyer**) | An order is created (you buy something) | Complete Checkout creates the order and an "Order created" webhook is queued |
| `ship` | The merchant marks it shipped | **Not a UCP call**: the business appends a fulfillment event to its own order |
| `webhook` | A webhook is generated and delivered | `POST` to the platform's `webhook_url`; headers `Webhook-Id`, `Webhook-Timestamp`, `UCP-Agent`, `Content-Digest`, `Signature-Input`, `Signature`; RFC 9421, ES256; body is the full order |
| `receive` | The platform receives and verifies | Signature against the key in the business profile, signer must own the order, dedupe by `Webhook-Id`, ack, apply asynchronously |
| `dashboard` | The dashboard reflects the update | The platform's webhook-built state must equal the business's own `GET /orders/{id}` |

## 6. Version compatibility (`version-compatibility`)

| Step | What happens | Protocol |
|---|---|---|
| `compatible` | Same protocol and capability versions | The platform selects the newest mutual version and intersects capabilities by exact version equality |
| `incompatible` | The platform only speaks `2026-01-11` | No common version: the platform stops; a business must answer `version_unsupported` (HTTP 422) |
| `enforce` | The business enforces it even if the platform ignores the check | A forced `POST /checkout-sessions` gets `422 version_unsupported`; no resource is created |
| `skew` | Discount is advertised at a different version | No mutual version, so the extension is excluded; checkout still works |
| `restore` | Housekeeping | Later pages use the compatible platform again |

## 7. Discount and fulfillment extensions (`discount-fulfillment`)

| Step | What happens | Protocol |
|---|---|---|
| `create` | The agent creates a checkout; the merchant advertises its extensions | `ucp.capabilities` in the response lists the active, relevant ones (checkout, fulfillment, discount) |
| `codes` | The agent requests discounts | `discounts.codes` (replacement semantics, case-insensitive): one per-item, one order-level, one expired |
| `eligible` | The merchant returns the eligible discounts | `discounts.applied[]` (`method` each/across, `priority`, `allocations`), rejected codes echoed with a warning and a spec code, and an automatic discount |
| `fulfillment` | Fulfillment options are calculated | `fulfillment.methods[].groups[].options[]`, priced by the merchant |
| `update` | The checkout is updated with the chosen option | `selected_option_id`; totals recomputed; `ready_for_complete` |

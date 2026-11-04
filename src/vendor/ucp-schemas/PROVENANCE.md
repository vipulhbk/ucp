# Vendored: official UCP JSON Schema source documents (reference display only)

* Upstream: https://github.com/Universal-Commerce-Protocol/ucp (Apache-2.0, see LICENSE)
* Tag `v2026-08-25`, commit `87dd4b1fcff9105d68173120897237fa784c74ef`, directory `source/schemas/`
* Copied **unmodified**. These are the *source* schemas: they still carry `ucp_request` / `ucp_response` annotations that the
  upstream `ucp-schema` tool resolves into per-operation variants.

## What they are used for

Only to **show** the "expected schema" next to a validation result in the Schema Validator. They are **not** what validates
payloads: validation uses the Zod schemas generated from these documents (`src/vendor/ucp-sdk`). The upstream resolver
(`ucp-schema`, a Rust tool) is not available in this environment, so the app does not validate against the raw JSON Schema
documents directly; the UI says so.

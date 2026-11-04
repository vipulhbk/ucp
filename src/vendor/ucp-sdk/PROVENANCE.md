# Vendored: UCP JavaScript SDK generated schemas

* Upstream: https://github.com/Universal-Commerce-Protocol/js-sdk (Apache-2.0, see LICENSE)
* File: `src/spec_generated.ts`, copied **unmodified** from commit `3a86b3a760c3c15d3bf5c44e018e532d4b44e616` (package version `0.6.0`)
* Generated against UCP schema release `2026-08-25` (`generate_models.sh` default; branch `release/2026-08-25`)

## Why vendored instead of `npm i @ucp-js/sdk`

`@ucp-js/sdk@0.5.1` (latest on npm, 2026-09-02) is generated with the older generator and its
`UcpDiscoveryProfileSchema` does **not** accept a 2026-08-25 profile (it expects `capabilities` as an array and
`services[name]` as an object; the 2026-08-25 spec uses registries keyed by name containing arrays). Verified with the
spec's own business-profile example. The repository's `main` (0.6.0, not yet published to npm) accepts it.

Replace this directory with the npm package once a release ≥0.6.0 is published, then re-run the profile tests.

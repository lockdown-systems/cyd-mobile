# ADR 0001: Shared Cyd Bluesky archive format

Cyd and Cyd Mobile share one Bluesky archive format for import, export, and
recovery. The normative contract is `docs/archive/bluesky/v2/` in the
[cyd repo](https://github.com/lockdown-systems/cyd) — its README, SQLite
schema, and canonical fixtures are the single source of truth, mirrored by
this repo's pinned contract bundle (`scripts/archive-contract/pin.json`).
Conformance is enforced by tests in both repos, not by prose.

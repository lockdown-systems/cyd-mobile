# The Cyd Bluesky archive v2 conformance matrix

The release gate for Mobile's version 2 writer (#100, ADR 0004).

```bash
npm run test:archive-matrix          # run it
python3 scripts/archive-contract/matrix.py --list   # just the rows
```

## What it is

A named list of the things a Cyd Bluesky archive has to do for Mobile to claim
version 2 conformance, each row tied to the tests that prove it. The rows live
in `scripts/archive-contract/matrix.py`; that file is the matrix, and this one
only explains it.

A row fails two ways, and the second is the reason the matrix exists at all:

- **red** — a test behind the row failed or was skipped.
- **unproven** — no test matches the row's evidence any more, because it was
  renamed or deleted. Evidence spread across eighty test files is evidence
  nobody can audit; without this, a rename in good faith would silently retire
  a release gate.

## What it runs

1. **Mobile's whole Jest suite**, with `CYD_BLUESKY_CONTRACT_ROOT` pointing at
   a freshly downloaded copy of the pinned canonical bundle. That is what wakes
   up `services/__tests__/archive-contract-bundle.test.ts` and
   `archive-contract-exchange.test.ts`, both of which skip without it — so they
   run here and in `npm run test:archive-contract`, and nowhere else.
2. **`conformance.py` over archives Mobile's own writer produced**: the two
   committed real-data fixtures, and the archive the round-trip test writes
   from a canonical Desktop one. Mobile checking its own output with its own
   reader would prove nothing; this checks it against the pinned contract.
3. **`self_test.py`'s mutation cases**, so the checker doing (2) is known to
   still reject the archives it should.

## Both directions

`archive-contract-exchange.test.ts` is where the bidirectional rows live.

- **Desktop to Mobile** — a canonical archive goes through intake, restore and
  merge, and what comes out is asserted through Mobile's own browse queries and
  the files on disk. Repeated import changes nothing; merging the complete
  fixture into an account restored from the incomplete one recovers the video
  it could not carry, through a handle change, by DID.
- **Mobile to Desktop** — that restored account is re-exported through Mobile's
  writer, and the result is compared to the canonical archive by normalized
  semantics and then handed to the contract's own checker.

The round trip is lossy in ways Mobile cannot help, listed in
`bluesky-archive-fixtures.md`. Each loss is asserted **as a loss**, under
"what a Mobile round trip loses, on purpose". An unasserted loss is
indistinguishable from a regression, and fixing one is meant to fail its test.

## Changing it

Adding a capability to the archive means adding a row, not only a test. A test
nobody named in the matrix is a test the release gate does not know about.

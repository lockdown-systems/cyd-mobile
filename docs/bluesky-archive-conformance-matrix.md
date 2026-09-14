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

A row's evidence carries a count (`least=`). Substring-matching a describe
block is convenient and weak on its own — `"rejects"` covers a dozen tests, so
deleting the one that carries the row's claim would leave the row green. The
count pins the size of the evidence, so a deletion fails the matrix and whoever
made it has to say so in the row.

## What it runs

1. **Mobile's whole Jest suite**, with `CYD_BLUESKY_CONTRACT_ROOT` pointing at
   a freshly downloaded copy of the pinned canonical bundle. That is what wakes
   up `services/__tests__/archive-contract-bundle.test.ts` and
   `archive-contract-exchange.test.ts`, both of which skip without it.
2. **`conformance.py` over archives Mobile's own writer produced**: the two
   committed real-data fixtures, and the archive the round-trip test writes
   from a canonical Desktop one. Mobile checking its own output with its own
   reader would prove nothing; this checks it against the pinned contract.
3. **`self_test.py`'s mutation cases**, so the checker doing (2) is known to
   still reject the archives it should, and still accept the canonical
   fixtures.
4. **`git`**, for the one row no test can prove: `readers-released` walks every
   tag and the working tree and fails any that offers export without the
   modules that read a Cyd Bluesky archive (ADR 0004).

Because it does all of that, it subsumes `npm run test:archive-contract` and
`npm run test:archive-conformance`, which CI no longer runs separately. Both
remain npm scripts: they are the quick ones to reach for locally.

## Both directions

`archive-contract-exchange.test.ts` is where the bidirectional rows live.

- **Desktop to Mobile** — a canonical archive goes through intake, restore and
  merge, and what comes out is asserted through Mobile's own browse queries and
  the files on disk. Repeated import changes nothing; merging the complete
  fixture into an account restored from the incomplete one recovers the video
  it could not carry, through a handle change, by DID.
- **Mobile to Desktop** — that restored account is re-exported through Mobile's
  writer, and the result is compared to the canonical archive by normalized
  semantics and then handed to the contract's own checker. Both fixtures make
  the trip, because an incomplete archive that came back looking complete would
  be a worse failure than the file it is missing.

The round trip is lossy in ways Mobile cannot help, listed in
`bluesky-archive-fixtures.md`. Each loss is asserted **as a loss**, under
"what a Mobile round trip loses, on purpose". An unasserted loss is
indistinguishable from a regression, and fixing one is meant to fail its test.

## Changing it

Adding a capability to the archive means adding a row, not only a test. A test
nobody named in the matrix is a test the release gate does not know about.

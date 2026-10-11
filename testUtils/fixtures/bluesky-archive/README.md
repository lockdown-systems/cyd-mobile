# Real-data Cyd Bluesky archive fixtures

`complete.cyd` and `incomplete.cyd` are Cyd Bluesky archives produced by Cyd
Mobile's own version 2 writer from a curated Bluesky test account. They carry
real facets, CIDs, JPEG bytes, and real identifiers, which synthetic generation
does not reproduce. They demonstrate **Mobile's behavior**; the pinned
canonical contract bundle (`scripts/archive-contract/pin.json`) is the
semantic oracle — if the fixtures and `npm run test:archive-contract` ever
disagree, the bundle is right.

## Provenance

| | |
| --- | --- |
| Account | `glittertop-cyd.bsky.social`, `did:plc:yn45xekh5kqrat27w6rmafcg` |
| Bluesky local account UUID | `b67bfc6c-6155-47ef-8273-71593e04f01a` |
| Pulled from | Android device (SM-S916U1), 2026-09-11 |
| Written by | the writer at `d93a981`, plus the `--created-at` flag added alongside these files |
| Contract pinned at | `cbd261484d0f3cac4f1c997c423db7730d5d3009` (`scripts/archive-contract/pin.json`) |
| `archive.created_at` | `2026-09-11T16:41:02.492Z`, pinned so the pair differs by one asset alone |
| Size | 2.6 MiB + 0.7 MiB = 3.3 MiB, against a 5 MiB budget |

Both pass `npm run check:archive-conformance`.

## What the pair is

`incomplete.cyd` differs from `complete.cyd` by exactly one asset — the
1.9 MiB image, whose download was failed for the length of that one export —
and by the `archive.completeness` value that follows from it. Every other row
in every other table is identical. It is the largest payload on purpose:
failing it is what keeps the second fixture small.

Only accounts the maintainer controls are in here:
`glittertop-cyd.bsky.social` and, as the other party to the conversation,
`aurorabyte-cyd.bsky.social`. Every post written by somebody else was removed
before export, along with both videos.

## Regenerating them

Regenerating from a new curated account is the supported path; it will
produce different identifiers, which is fine — nothing should assert on these
specific URIs. Recipe:

1. Curate the account: keep it under 5 MiB, and remove posts written by
   other accounts and any media, link previews, and captured profiles they
   leave behind.
2. `npm run check:account-readiness` to verify the pulled account directory.
3. `npm run export:archive` to produce `complete.cyd`.
4. Re-export with `--fail-asset` and the same pinned `--created-at` to produce
   `incomplete.cyd`.
5. `npm run check:archive-conformance` on both.
6. Commit both files with their provenance recorded in this README.

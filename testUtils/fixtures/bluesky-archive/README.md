# Real-data Cyd Bluesky archive fixtures

`complete.cyd` and `incomplete.cyd` are Cyd Bluesky archives Cyd Mobile's own
version 2 writer produced from a curated Bluesky test account (ADR 0016). They
carry real facets, CIDs, JPEG bytes, and real identifiers, which synthetic
generation does not reproduce.

They demonstrate **Mobile's behavior**, never the contract's meaning. The
pinned canonical bundle remains the semantic oracle (ADR 0008): if these and
`npm run test:archive-contract` ever disagree about what version 2 requires,
the bundle is right and these are wrong.

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

`incomplete.cyd` differs from `complete.cyd` by exactly one asset — the 1.9 MiB
image, whose download was failed for the length of that one export — and by the
`archive.completeness` value that follows from it. Every other row in every
other table is identical. It is the largest payload on purpose: failing it is
what keeps the second fixture small.

## What they cover

| Covered | Not covered |
| --- | --- |
| 16 posts, 2 reposts, 1 like, 1 conversation with 7 messages | bookmarks — none were saved |
| 5 images across 4 posts, 6 `record_assets` | video — the account's two videos were 45 MiB of its 48 MiB |
| 3 quotes, one resolving to a record in the archive | replies — every reply in the account was written by somebody else |
| portable save and delete settings | external context and `preview` assets — the only link post was somebody else's |
| an asset that is `missing`, and an honestly incomplete archive | `relationships` — Mobile never saves follows locally (see below) |

`docs/bluesky-archive-fixtures.md` lists everything Mobile cannot populate at
all, which is a longer list than this one.

### Whose data is in here

Only accounts the maintainer controls: `glittertop-cyd.bsky.social` and, as the
other party to the conversation, `aurorabyte-cyd.bsky.social`. Every post
written by somebody else was removed before export, along with both videos.

One exception, deliberate: `did:plc:z72i7hdynmk6r22z27h6tvur` appears as a
profile row with no handle and no other content. A post of the account's own
quotes that record, and an AT URI names its author, so the quote context keeps
the DID. Removing it would mean removing the quote.

## Regenerating them

The account they came from no longer exists in this state — it kept being used.
Regenerating from a *new* curated account is the supported path, and it will
produce different identifiers; that is fine, because nothing should assert on
these specific URIs. Follow `docs/bluesky-archive-fixtures.md`, and pass the
same `--created-at` to both exports.

The curation applied to this one, on a pulled copy rather than on the device:

- removed both posts carrying video (45 MiB of 48 MiB);
- removed every post written by somebody else — three reposts and one like of
  `bsky.app`, one like each of two individuals' posts;
- removed the media, link previews, and captured profiles those left behind.

Likes and reposts survived that because the account had liked one of its own
posts and reposted two others.

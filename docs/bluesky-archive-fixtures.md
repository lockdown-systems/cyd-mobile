# Producing real-data Cyd Bluesky archive fixtures

How to turn a curated Bluesky test account into the committed `complete` and
`incomplete` fixtures that #98 requires and #96 is built against.

## What these fixtures are for

They carry real facets, CIDs, JPEG and MP4 bytes, and real identifiers, which
synthetic generation does not reproduce. They are **not** a replacement for the
pinned canonical fixtures, which remain the semantic oracle (ADR 0008, ADR
0016). Keep running `npm run test:archive-contract`.

They are also **not a superset**. Mobile cannot populate several interchange
groups at all, so these fixtures exercise less of the contract than
`complete.cyd` does:

| Interchange | Why Mobile leaves it empty |
| --- | --- |
| `relationships` block, mute | Mobile stores follows only |
| `profiles.avatar_asset_id`, banner | avatars are URLs, never content-addressed |
| `profiles.description`, `records.indexed_at` | not stored |
| captured historical profiles | `profile` is `UNIQUE(did)`, updated in place |
| `records.first_observed_at` vs `observed_at` | one `savedAt` column, so both are equal |
| `assets` kind `preview`, `thumbnail` | `media_asset` is `image\|video` only |
| `record_assets` owner `profile`, `message` | written only from post persistence |

`check_account_readiness.py` reprints this list, so it stays visible at the
moment it matters rather than only here.

## 1. Curate the account first

Media dominates the size; `data.db` is tens of KiB. Budget **5 MiB** for the
committed fixture, and reach it by deleting data from the test account before
exporting rather than by trimming the archive afterward — committed media
persists in repository history, so a fixture regenerated a few times over is
permanently expensive.

Aim to cover, in as few records as possible: a plain post, a reply, a quote
post, a post with an external link, a post with images, a post with video, a
repost, a like, a bookmark, one chat conversation with a couple of messages,
and a follow. One or two records per category is enough — this is a semantic
fixture, not a load test.

Third parties land in `relationships` and `conversation_members`. Point the
follow and the chat at a second account you control so the fixture is entirely
yours.

## 2. Save everything, and let media finish

Connect the test account in a dev build and run each save job. Media downloads
continue after the records land, and a pending download silently becomes an
`unavailable` asset — which turns a fixture meant to be `complete` into an
`incomplete` one that still looks fine.

## 3. Pull the account database and check readiness

Account data lives at `<documents>/accounts/bluesky-<uuid>/`, holding `data.db`
and `media/`. On Android that is:

```bash
adb exec-out run-as systems.lockdown.cydmobile \
  cat files/accounts/bluesky-<uuid>/data.db > /tmp/data.db
```

On an iOS simulator it is under
`~/Library/Developer/CoreSimulator/Devices/<device>/data/Containers/Data/Application/<app>/Documents/`.

```bash
npm run check:account-readiness -- /tmp/data.db
```

It reports category coverage, context coverage, media download state, and the
projected fixture size, and exits non-zero when the account is not ready.

## 4. Export, then check conformance

Export through Mobile's v2 writer, then — before trusting the result — check it
against the pinned contract rather than against Mobile's own idea of the format:

```bash
npm run check:archive-conformance -- path/to/complete.cyd
```

This matters more than usual right now: Mobile builds its writer before the
reader that would otherwise catch its mistakes (ADR 0004), so until #96 lands
this checker is the only thing standing between a broken writer and a fixture
that enshrines its bugs.

## 5. Produce the incomplete variant

`incomplete.cyd` differs from `complete.cyd` by one unavailable asset. Get there
by failing a single download rather than by damaging the account — set one
`media_asset` row to `downloadState = 'failed'` and export again. The result
must report `completeness: incomplete`, keep every other record intact, and
still pass conformance.

## 6. Commit with provenance

Record alongside the fixtures: which test account produced them, the app
version and commit, the date, which records were curated in, and the steps to
regenerate. A fixture nobody can regenerate becomes unchangeable the moment the
contract moves.

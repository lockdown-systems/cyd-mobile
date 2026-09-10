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

| Interchange | Why Mobile leaves it empty, or fills it differently |
| --- | --- |
| `relationships` block, mute | Mobile stores follows only |
| `profiles.avatar_asset_id`, banner | avatars are URLs, never content-addressed |
| `profiles.description`, `records.indexed_at` | not stored |
| captured historical profiles | `profile` is `UNIQUE(did)`, updated in place |
| `records.first_observed_at` vs `observed_at` | one `savedAt` column, so both are equal |
| `assets` kind `thumbnail` | a video's own thumbnail is a URL, never preserved; link preview thumbnails *are* packaged, as `preview` |
| `record_assets` owner `profile`, `message` | written only from post persistence |
| `records.created_at` of a like or repost | Mobile stores the relationship's URI but never its creation time, so this is the observation time |
| `selections` for bookmarks | Mobile has no bookmark record URI, so the selection names the bookmarked post and there is no `record_subjects` row |
| a bookmark removed at source | with no bookmark record, there is nowhere to carry its deletion state |
| a like removed at source whose URI Cyd never saw | the selection names the post, and there is no like record to carry the deletion state |
| a link preview Cyd never downloaded | no asset row at all; the URL stays in the record's external context, and it does not make the archive incomplete |
| context for a record Cyd never saved | `record_context` keeps the author the AT URI names; `context_record_uri` stays `NULL` and the URI itself survives in `records.payload_json` |
| `portable_settings.save_reposts` | Mobile has no separate switch: reposts are saved with posts |

`check_account_readiness.py` reprints this list, so it stays visible at the
moment it matters rather than only here.

## 1. Curate the account first

Media dominates the size; `data.db` compresses to a few KiB inside the archive.
Budget **5 MiB** for the committed fixture, and reach it by deleting data from
the test account before exporting rather than by trimming the archive
afterward — committed media persists in repository history, so a fixture
regenerated a few times over is permanently expensive.

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
unavailable asset — which turns a fixture meant to be `complete` into an
`incomplete` one that still looks fine.

## 3. Pull the account directory and check readiness

Account data lives at `<documents>/accounts/bluesky-<uuid>/`, holding `data.db`
and `media/`. Pull the whole directory, not just the database: the export reads
the preserved media too. On Android:

```bash
adb exec-out run-as systems.lockdown.cydmobile \
  tar c files/accounts/bluesky-<uuid> | tar x -C /tmp/cyd-fixture-account --strip-components=2
adb exec-out run-as systems.lockdown.cydmobile cat files/main.db > /tmp/cyd-fixture-account/main.db
```

On an iOS simulator the same directory is under
`~/Library/Developer/CoreSimulator/Devices/<device>/data/Containers/Data/Application/<app>/Documents/`.

`main.db` is optional but worth pulling: it is where the account's DID and its
save and delete defaults live, and passing it means the fixture's portable
settings are the account's real ones.

```bash
npm run check:account-readiness -- /tmp/cyd-fixture-account/data.db
```

It reports category coverage, context coverage, media download state, and the
projected fixture size, and exits non-zero when the account is not ready.

## 4. Export the complete fixture

`npm run export:archive` runs Mobile's own version 2 writer over the pulled
copy (ADR 0016), so the fixture is what the app itself would have produced:

```bash
npm run export:archive -- /tmp/cyd-fixture-account \
  --main-db /tmp/cyd-fixture-account/main.db \
  --out testUtils/fixtures/bluesky-archive/complete.cyd
```

Without `--main-db`, pass `--did` (and optionally `--handle`); the account UUID
is read from the directory name. The command prints a provenance block to paste
into this file.

Then check the result against the pinned contract rather than against Mobile's
own idea of the format:

```bash
npm run check:archive-conformance -- testUtils/fixtures/bluesky-archive/complete.cyd
```

This matters more than usual right now: Mobile builds its writer before the
reader that would otherwise catch its mistakes (ADR 0004), so until #96 lands
this checker is the only thing standing between a broken writer and a fixture
that enshrines its bugs.

## 5. Produce the incomplete variant

`incomplete.cyd` differs from `complete.cyd` by one unavailable asset. Get
there by failing a single download rather than by damaging the account or
editing the archive, so every other record and payload stays identical:

```bash
npm run export:archive -- /tmp/cyd-fixture-account \
  --main-db /tmp/cyd-fixture-account/main.db \
  --fail-asset <contentCid> \
  --out testUtils/fixtures/bluesky-archive/incomplete.cyd
```

`--fail-asset` marks that one `media_asset` row failed for the length of the
export and puts it back afterwards, and only ever touches the pulled copy. Pick
the video: it is the largest payload, so leaving it out is also what keeps the
incomplete fixture small. The result must report `completeness: incomplete`,
keep every other record intact, and still pass conformance.

## 6. Commit with provenance

Record alongside the fixtures: which test account produced them, the app
version and commit, the date, which records were curated in, and the steps to
regenerate. A fixture nobody can regenerate becomes unchangeable the moment the
contract moves. `testUtils/fixtures/bluesky-archive/README.md` is where that
goes.

## Exporting from the app instead

The dashboard carries a development-only export card in `__DEV__` builds
(ADR 0004). It writes the same archive through the same writer, into
`<documents>/archive-export/<exportId>/`, and prints the path. Pulling that
file works too — but every fix then costs a device round trip, which is why the
fixtures are made from a pulled copy instead.

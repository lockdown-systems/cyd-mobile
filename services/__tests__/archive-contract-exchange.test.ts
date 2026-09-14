import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  buildFirstPageQuery,
  buildMediaForPostsQuery,
  buildTotalCountQuery,
  getFirstPageParams,
  getTotalCountParams,
  groupMediaByPost,
  type BrowseType,
  type MediaRow,
} from "@/components/account/browse-shared";
import { ACCOUNT_AUTH_STATUS, ACCOUNT_CONFIG_KEYS } from "@/controllers/config";
import {
  runBlueskyArchiveIntake,
  type PreparedBlueskyArchive,
} from "@/services/archive-import";
import {
  chooseBlueskyArchiveImportDestination,
  commitBlueskyArchiveMerge,
  previewBlueskyArchiveMerge,
  totalMergeChanges,
} from "@/services/archive-merge";
import {
  runBlueskyArchiveExport,
  type PortableSettings,
} from "@/services/archive-export";
import { restoreBlueskyArchiveAccount } from "@/services/archive-restore";
import {
  createDiskBlueskyArchiveIntakeEnvironment,
  createNodeBlueskyArchiveRestoreEnvironment,
  type NodeRestoreEnvironment,
} from "@/testUtils/archiveEnvironments";
import { createMemoryByteReader } from "@/testUtils/archiveFixtures";
import { createNodeBlueskyArchiveExportEnvironment } from "@/testUtils/nodeExportEnvironment";

import { readArchiveTables, unzipArchive } from "@/testUtils/archiveTables";

import { classifyBlueskyArchiveMetadata } from "../archive-metadata";
import { normalizeBlueskyArchiveSemantics } from "../archive-semantics";

/**
 * The bidirectional half of the Cyd Bluesky archive v2 conformance matrix.
 *
 * `archive-contract-bundle.test.ts` proves Mobile *understands* the pinned
 * canonical fixtures: it normalizes them and takes them into staging. That is
 * not the same as interoperating with Desktop, which is what #100 gates the
 * writer on, and what this covers instead — both directions, end to end:
 *
 * - Desktop to Mobile: a canonical archive becomes a Bluesky local account
 *   somebody can browse offline, merges idempotently, and recovers a file an
 *   earlier archive could not carry.
 * - Mobile to Desktop: Mobile's own writer rewrites that restored account as a
 *   Cyd Bluesky archive, and what comes out still says what Desktop said.
 *
 * Comparisons are semantic throughout (#91): normalized wire names, browse
 * queries, and media digests, never ZIP byte order or Mobile's private tables.
 *
 * The round trip is lossy in ways Mobile cannot help — `docs/
 * bluesky-archive-fixtures.md` lists them — so every loss is asserted here as
 * a loss rather than skipped. A new one fails these tests, which is the point:
 * the matrix is what stands between "Mobile wrote an archive" and "Desktop can
 * still read what was in it".
 */

const contractRoot = process.env.CYD_BLUESKY_CONTRACT_ROOT;
const contractDescribe = contractRoot ? describe : describe.skip;

/**
 * Where the round trip leaves the archive Mobile wrote.
 *
 * The pinned contract's own checker is Python, and it is the only thing that
 * can say an archive Mobile produced conforms rather than merely round-trips
 * through Mobile. `scripts/archive-contract/matrix.py` sets this, collects
 * what lands here, and runs `conformance.py` over it.
 */
const roundTripOutput = process.env.CYD_BLUESKY_ROUND_TRIP_OUT;

const ACCOUNT_DID = "did:plc:canonicalalice";
const ACCOUNT_UUID = "018d5f7a-9b3c-7d10-8a2e-1f4c6b8d0e12";
const ACCOUNT_HANDLE = "alice.example";
const OWN_POST = `at://${ACCOUNT_DID}/app.bsky.feed.post/post`;
const LIKE_RECORD = `at://${ACCOUNT_DID}/app.bsky.feed.like/like`;
const BOOKMARK_RECORD = `at://${ACCOUNT_DID}/app.bsky.graph.listitem/bookmark`;
const VIDEO_DIGEST =
  "f7a5be429b0d633d22038d97f5930c95e8403643fbb5b4e7274ee5ec16018cde";
const IMAGE_DIGEST =
  "6c55d7bbccd73bb135e8e7c7161b4be3cef97142313f2fba304e73b3329ecc3d";

function canonicalArchive(name: string): Uint8Array {
  return new Uint8Array(
    fs.readFileSync(path.join(contractRoot!, "fixtures", name)),
  );
}

type Installation = {
  root: string;
  environment: NodeRestoreEnvironment;
  close(): void;
};

function createInstallation(label: string): Installation {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `cyd-${label}-`));
  const environment = createNodeBlueskyArchiveRestoreEnvironment({
    root: path.join(root, "app"),
    newUuid: () => crypto.randomUUID(),
  });
  return {
    root,
    environment,
    close: () => {
      environment.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

let intakes = 0;

/** Read a canonical archive into this installation's staging, as the app does. */
async function intake(
  installation: Installation,
  name: string,
): Promise<PreparedBlueskyArchive> {
  const intakeId = `contract-intake-${(intakes += 1)}`;
  const outcome = await runBlueskyArchiveIntake(
    createDiskBlueskyArchiveIntakeEnvironment(
      path.join(installation.root, "intake"),
    ),
    {
      intakeId,
      // Deliberately not an archive name: validity comes from the contents.
      sourceUri: "file:///picked/holiday-photos.zip",
      openReader: async () => createMemoryByteReader(canonicalArchive(name)),
    },
  );
  if (outcome.status !== "prepared") {
    throw new Error(`intake did not prepare ${name}: ${outcome.status}`);
  }
  return outcome;
}

/**
 * The normalized rows, as rows.
 *
 * `normalizeBlueskyArchiveSemantics` builds each row by spreading a mapped
 * `Record<string, unknown>`, and TypeScript drops an index signature when it
 * is spread into a literal — so the inferred row type knows only about the
 * two fields added afterwards. Nothing is being widened here that was ever
 * narrow.
 */
const castRows = (value: unknown): Record<string, unknown>[] =>
  value as Record<string, unknown>[];

function browseCount(database: DatabaseSync, type: BrowseType): number {
  const row = database
    .prepare(buildTotalCountQuery(type))
    .get(...(getTotalCountParams(type, ACCOUNT_DID) as never[])) as {
    count: number;
  };
  return row.count;
}

function browseFirstPage(
  database: DatabaseSync,
  type: BrowseType,
): Record<string, unknown>[] {
  return database
    .prepare(buildFirstPageQuery(type))
    .all(...(getFirstPageParams(type, ACCOUNT_DID) as never[])) as Record<
    string,
    unknown
  >[];
}

/** Every media file inside a restored Bluesky local account, by digest. */
function storedMedia(installation: Installation, accountUuid: string): string[] {
  const directory = path.join(
    installation.environment.accountDirectory(accountUuid),
    "media",
  );
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs
    .readdirSync(directory)
    .map((name) =>
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(directory, name)))
        .digest("hex"),
    )
    .sort();
}

contractDescribe("a canonical Desktop archive, restored by Mobile", () => {
  let installation: Installation;
  let account: Awaited<ReturnType<typeof restoreBlueskyArchiveAccount>>;
  let database: DatabaseSync;

  beforeAll(async () => {
    installation = createInstallation("desktop-to-mobile");
    const prepared = await intake(installation, "complete.cyd");
    account = await restoreBlueskyArchiveAccount(installation.environment, {
      archive: {
        intakeId: prepared.intakeId,
        stagingRoot: prepared.stagingRoot,
      },
    });
    database = installation.environment.openRestoredAccountDatabase(
      account.accountUuid,
    );
  });

  afterAll(() => {
    database.close();
    installation.close();
  });

  it("keeps the Bluesky identity the archive names", () => {
    expect(account.accountDid).toBe(ACCOUNT_DID);
    expect(account.accountUuid).toBe(ACCOUNT_UUID);
    expect(account.handle).toBe(ACCOUNT_HANDLE);
    expect(account.uuidRemapping).toBeNull();
  });

  it("browses every category the canonical archive selected", () => {
    expect({
      posts: browseCount(database, "posts"),
      reposts: browseCount(database, "reposts"),
      likes: browseCount(database, "likes"),
      bookmarks: browseCount(database, "bookmarks"),
    }).toEqual({ posts: 1, reposts: 1, likes: 1, bookmarks: 1 });
    // Chats are not a browse query; the restore reports what it wrote.
    expect(account.counts).toMatchObject({ chats: 1, messages: 1 });
  });

  it("restores the post Desktop saved, with the text Desktop had", () => {
    const posts = browseFirstPage(database, "posts");
    expect(posts.map((post) => post.uri)).toContain(OWN_POST);
    expect(posts.find((post) => post.uri === OWN_POST)?.text).toBe(
      "Own post with full video",
    );
  });

  it("keeps a source deletion Desktop observed", () => {
    const quote = database
      .prepare("SELECT deletedPostAt FROM post WHERE uri = ?;")
      .get("at://did:plc:canonicalbob/app.bsky.feed.post/quote") as
      | { deletedPostAt: number | null }
      | undefined;
    expect(quote?.deletedPostAt).toBe(Date.parse("2026-01-10T00:00:00.000Z"));
  });

  it("stores each canonical asset once, content-addressably", () => {
    // Four assets, and the image is referenced twice — once as the account's
    // avatar and once inside the post. Per-account deduplication is what makes
    // that one file rather than two (ADR 0007).
    const digests = storedMedia(installation, account.accountUuid);
    expect(new Set(digests).size).toBe(digests.length);
    expect(digests).toContain(IMAGE_DIGEST);
    expect(digests).toContain(VIDEO_DIGEST);
  });

  /**
   * Offline browsing, asked through the query Browse itself runs.
   *
   * Asserting `media_asset` rows would only prove restore wrote something. What
   * has to be true is that the attachments Browse builds for a saved post point
   * at bytes on this device, so a post renders with the Bluesky CDN
   * unreachable — which is the whole promise of a Cyd Bluesky archive.
   */
  it("gives Browse local files for every attachment, so posts render with no network", () => {
    const attachments = groupMediaByPost(
      database
        .prepare(buildMediaForPostsQuery(1))
        .all(OWN_POST) as MediaRow[],
    ).get(OWN_POST);

    expect(attachments?.length).toBeGreaterThan(0);
    for (const attachment of attachments ?? []) {
      expect(attachment.downloadState).toBe("complete");
      expect(attachment.localUri?.startsWith("file://")).toBe(true);
      expect(
        fs.existsSync((attachment.localUri as string).slice("file://".length)),
      ).toBe(true);
    }
    // Both the image and the full video, not a thumbnail standing in for one.
    expect(attachments?.map((attachment) => attachment.type).sort()).toEqual([
      "image",
      "video",
    ]);
  });

  it("records that the restored backup is complete", () => {
    expect(account.completeness).toBe("complete");
    expect(account.assets.missing).toBe(0);
  });

  it("applies the archive's save and delete defaults to the new account", () => {
    const row = installation.environment.mainDatabase
      .prepare(
        `SELECT b.settingSavePosts, b.settingSaveLikes, b.settingSaveBookmarks,
                b.settingSaveChats, b.settingDeletePosts,
                b.settingDeleteUnfollowEveryone
         FROM account a INNER JOIN bsky_account b ON b.id = a.bskyAccountID
         WHERE a.uuid = ?;`,
      )
      .get(account.accountUuid) as Record<string, number>;
    expect(row).toEqual({
      settingSavePosts: 1,
      settingSaveLikes: 1,
      settingSaveBookmarks: 1,
      settingSaveChats: 1,
      settingDeletePosts: 1,
      settingDeleteUnfollowEveryone: 0,
    });
  });

  it("leaves the account disconnected, with no credentials and no schedule", () => {
    const status = database
      .prepare("SELECT value FROM config WHERE key = ?;")
      .get(ACCOUNT_CONFIG_KEYS.authStatus) as { value: string } | undefined;
    expect(status?.value).toBe(ACCOUNT_AUTH_STATUS.signedOut);

    const scheduled = installation.environment.mainDatabase
      .prepare(
        `SELECT b.settingScheduleDeletion FROM account a
         INNER JOIN bsky_account b ON b.id = a.bskyAccountID WHERE a.uuid = ?;`,
      )
      .get(account.accountUuid) as { settingScheduleDeletion: number };
    expect(scheduled.settingScheduleDeletion).toBe(0);
  });
});

contractDescribe("importing the same canonical archive twice", () => {
  let installation: Installation;

  beforeAll(async () => {
    installation = createInstallation("repeat-import");
    const first = await intake(installation, "complete.cyd");
    await restoreBlueskyArchiveAccount(installation.environment, {
      archive: { intakeId: first.intakeId, stagingRoot: first.stagingRoot },
    });
  });

  afterAll(() => installation.close());

  it("merges rather than restoring, because the DID is already here", async () => {
    const identities =
      await installation.environment.listLocalAccountIdentities();
    expect(
      chooseBlueskyArchiveImportDestination(ACCOUNT_DID, identities),
    ).toMatchObject({ kind: "merge" });
  });

  it("changes nothing the second time", async () => {
    const prepared = await intake(installation, "complete.cyd");
    const identities =
      await installation.environment.listLocalAccountIdentities();
    const destination = chooseBlueskyArchiveImportDestination(
      ACCOUNT_DID,
      identities,
    );
    if (destination.kind !== "merge") {
      throw new Error("expected the second import to merge");
    }

    const preview = await previewBlueskyArchiveMerge(installation.environment, {
      archive: {
        intakeId: prepared.intakeId,
        stagingRoot: prepared.stagingRoot,
      },
      account: destination.account,
    });
    expect(totalMergeChanges(preview.summary)).toMatchObject({
      records: { added: 0, updated: 0 },
      files: { added: 0, updated: 0 },
    });

    const result = await commitBlueskyArchiveMerge(
      installation.environment,
      preview,
    );
    expect(result.written).toBe(0);
  });
});

contractDescribe("merging a richer canonical archive into an older one", () => {
  let installation: Installation;
  let accountUuid: string;

  beforeAll(async () => {
    installation = createInstallation("mixed-device");
    const first = await intake(installation, "incomplete.cyd");
    const restored = await restoreBlueskyArchiveAccount(
      installation.environment,
      {
        archive: { intakeId: first.intakeId, stagingRoot: first.stagingRoot },
      },
    );
    accountUuid = restored.accountUuid;
  });

  afterAll(() => installation.close());

  it("starts from an archive whose video never made it", () => {
    expect(storedMedia(installation, accountUuid)).not.toContain(VIDEO_DIGEST);
  });

  it("recovers the file the earlier archive could not carry", async () => {
    // The handle moved on since the first archive, which must not matter:
    // routing is by DID (#91).
    installation.environment.mainDatabase
      .prepare("UPDATE bsky_account SET handle = ? WHERE did = ?;")
      .run("alice-renamed.example", ACCOUNT_DID);

    const prepared = await intake(installation, "complete.cyd");
    const identities =
      await installation.environment.listLocalAccountIdentities();
    const destination = chooseBlueskyArchiveImportDestination(
      ACCOUNT_DID,
      identities,
    );
    if (destination.kind !== "merge") {
      throw new Error("expected a merge into the account holding the DID");
    }
    expect(destination.account.uuid).toBe(accountUuid);

    const preview = await previewBlueskyArchiveMerge(installation.environment, {
      archive: {
        intakeId: prepared.intakeId,
        stagingRoot: prepared.stagingRoot,
      },
      account: destination.account,
    });
    const result = await commitBlueskyArchiveMerge(
      installation.environment,
      preview,
    );

    expect(totalMergeChanges(result.summary).files.updated).toBe(1);
    expect(storedMedia(installation, accountUuid)).toContain(VIDEO_DIGEST);
  });

  it("keeps the account's own identifier and its renamed handle", () => {
    const row = installation.environment.mainDatabase
      .prepare(
        `SELECT a.uuid, b.handle FROM account a
         INNER JOIN bsky_account b ON b.id = a.bskyAccountID WHERE b.did = ?;`,
      )
      .get(ACCOUNT_DID) as { uuid: string; handle: string };
    expect(row).toEqual({
      uuid: accountUuid,
      handle: "alice-renamed.example",
    });
  });
});

/** What a canonical archive looks like after Mobile has read and rewritten it. */
type RoundTrip = {
  installation: Installation;
  canonical: ReturnType<typeof normalizeBlueskyArchiveSemantics>;
  rewritten: ReturnType<typeof normalizeBlueskyArchiveSemantics>;
  entries: Record<string, Uint8Array>;
};

/**
 * Restore a canonical archive, then export the account it became.
 *
 * The whole Mobile-to-Desktop direction in one function: what comes out was
 * written by Mobile's own writer, from data Desktop wrote, so comparing the
 * two ends says whether an archive survives the trip through Mobile's private
 * storage and back (#100).
 */
async function roundTrip(label: string, fixtureName: string): Promise<RoundTrip> {
  const installation = createInstallation(label);
  const prepared = await intake(installation, fixtureName);
  const account = await restoreBlueskyArchiveAccount(installation.environment, {
    archive: { intakeId: prepared.intakeId, stagingRoot: prepared.stagingRoot },
  });

  const settings = installation.environment.mainDatabase
    .prepare(
      `SELECT b.settingSavePosts, b.settingSaveLikes, b.settingSaveBookmarks,
              b.settingSaveChats, b.settingDeletePosts, b.settingDeleteReposts,
              b.settingDeleteLikes, b.settingDeleteBookmarks,
              b.settingDeleteChats, b.settingDeleteUnfollowEveryone
       FROM account a INNER JOIN bsky_account b ON b.id = a.bskyAccountID
       WHERE a.uuid = ?;`,
    )
    .get(account.accountUuid) as Record<string, number>;
  const portableSettings = Object.fromEntries(
    Object.entries({
      save_posts: settings.settingSavePosts,
      save_likes: settings.settingSaveLikes,
      save_bookmarks: settings.settingSaveBookmarks,
      save_chats: settings.settingSaveChats,
      delete_posts: settings.settingDeletePosts,
      delete_reposts: settings.settingDeleteReposts,
      delete_likes: settings.settingDeleteLikes,
      delete_bookmarks: settings.settingDeleteBookmarks,
      delete_chats: settings.settingDeleteChats,
      delete_follows: settings.settingDeleteUnfollowEveryone,
    }).map(([key, value]) => [key, value !== 0]),
  ) as PortableSettings;

  const result = await runBlueskyArchiveExport(
    createNodeBlueskyArchiveExportEnvironment({
      accountDirectory: installation.environment.accountDirectory(
        account.accountUuid,
      ),
      stagingRoot: path.join(installation.root, "export"),
      now: () => new Date("2026-02-01T00:00:00.000Z"),
    }),
    {
      exportId: `round-trip-${label}`,
      accountUuid: account.accountUuid,
      accountDid: account.accountDid,
      accountHandle: account.handle,
      portableSettings,
    },
  );

  const bytes = new Uint8Array(fs.readFileSync(result.location));
  if (roundTripOutput) {
    // The pinned contract's own checker is Python, and it is the only thing
    // that can say an archive Mobile produced conforms rather than merely
    // round-trips through Mobile. `matrix.py` collects whatever lands here.
    fs.mkdirSync(roundTripOutput, { recursive: true });
    fs.writeFileSync(
      path.join(roundTripOutput, `mobile-round-trip-${label}.cyd`),
      bytes,
    );
  }

  const entries = unzipArchive(bytes);
  return {
    installation,
    entries,
    rewritten: normalizeBlueskyArchiveSemantics(
      readArchiveTables(entries["data.db"]),
    ),
    canonical: normalizeBlueskyArchiveSemantics(
      readArchiveTables(unzipArchive(canonicalArchive(fixtureName))["data.db"]),
    ),
  };
}

contractDescribe("a canonical Desktop archive, rewritten by Mobile", () => {
  let installation: Installation;
  let canonical: RoundTrip["canonical"];
  let rewritten: RoundTrip["rewritten"];
  let rewrittenEntries: Record<string, Uint8Array>;

  beforeAll(async () => {
    ({
      installation,
      canonical,
      rewritten,
      entries: rewrittenEntries,
    } = await roundTrip("complete", "complete.cyd"));
  });

  afterAll(() => installation.close());

  it("writes a supported Bluesky version 2 archive and nothing else", () => {
    const metadata = JSON.parse(
      Buffer.from(rewrittenEntries["metadata.json"]).toString("utf8"),
    ) as Record<string, unknown>;
    expect(classifyBlueskyArchiveMetadata(metadata)).toMatchObject({
      supported: true,
    });
    expect(metadata).toMatchObject({
      format: "cyd-archive",
      platform: "bluesky",
      version: 2,
    });
  });

  it("still names the Bluesky identity and Bluesky local account Desktop named", () => {
    expect(rewritten.commonSemantics.archive).toMatchObject({
      accountDid: ACCOUNT_DID,
      accountUuid: ACCOUNT_UUID,
    });
    expect(rewritten.commonSemantics.identity).toMatchObject({
      did: ACCOUNT_DID,
    });
  });

  it("still says the backup is complete", () => {
    expect(rewritten.completeness).toBe("complete");
  });

  it("carries back every record Desktop wrote", () => {
    const uris = (rows: Record<string, unknown>[]) =>
      rows
        .map((row) => row.uri as string)
        .filter((uri) => uri !== BOOKMARK_RECORD)
        .sort();
    expect(uris(castRows(rewritten.commonSemantics.records))).toEqual(
      uris(castRows(canonical.commonSemantics.records)),
    );
  });

  it("carries back what each record said", () => {
    const byUri = (rows: Record<string, unknown>[]) =>
      Object.fromEntries(
        rows
          .filter((row) => row.uri !== BOOKMARK_RECORD)
          .map((row) => [
            row.uri,
            {
              text: row.text,
              sourceDeletedAt: row.sourceDeletedAt,
              // A like's own CID has no column in Mobile's storage; the
              // declared loss below is where that is pinned.
              ...(row.uri === LIKE_RECORD ? {} : { cid: row.cid }),
            },
          ]),
      );
    expect(byUri(castRows(rewritten.commonSemantics.records))).toEqual(
      byUri(castRows(canonical.commonSemantics.records)),
    );
  });

  it("carries back a selection per category Desktop selected", () => {
    expect(
      rewritten.commonSemantics.selections.map((row) => row.category).sort(),
    ).toEqual(
      canonical.commonSemantics.selections.map((row) => row.category).sort(),
    );
  });

  it("carries back the subject of every selection but the bookmark", () => {
    const selections = (rows: Record<string, unknown>[]) =>
      rows
        .filter((row) => row.category !== "bookmarks")
        .map((row) => `${row.category}:${row.subjectId}`)
        .sort();
    expect(selections(rewritten.commonSemantics.selections)).toEqual(
      selections(canonical.commonSemantics.selections),
    );
  });

  it("carries back the bounded context a record needs to render", () => {
    const context = (rows: Record<string, unknown>[]) =>
      rows
        .map((row) => `${row.recordUri}:${row.kind}:${row.contextRecordUri}`)
        .sort();
    expect(context(rewritten.commonSemantics.recordContext)).toEqual(
      context(canonical.commonSemantics.recordContext),
    );
  });

  it("carries back the conversation and what was said in it", () => {
    expect(castRows(rewritten.commonSemantics.conversations).map((row) => row.id)).toEqual(
      castRows(canonical.commonSemantics.conversations).map((row) => row.id),
    );
    expect(
      castRows(rewritten.commonSemantics.messages).map((row) => [row.id, row.text]),
    ).toEqual(
      castRows(canonical.commonSemantics.messages).map((row) => [row.id, row.text]),
    );
  });

  it("packages every available asset again, once each, with its bytes intact", () => {
    const available = (
      rows: Record<string, unknown>[],
    ): { digest: string; path: string }[] =>
      rows
        .filter((row) => row.availability === "available")
        .map((row) => ({
          digest: row.sha256 as string,
          path: row.archivePath as string,
        }))
        .sort((a, b) => a.digest.localeCompare(b.digest));

    const rewrote = available(rewritten.assets);
    expect(rewrote.map(({ digest }) => digest)).toContain(IMAGE_DIGEST);
    expect(rewrote.map(({ digest }) => digest)).toContain(VIDEO_DIGEST);
    expect(new Set(rewrote.map(({ path: entry }) => entry)).size).toBe(
      rewrote.length,
    );
    for (const { digest, path: entry } of rewrote) {
      const payload = rewrittenEntries[entry];
      expect(payload).toBeDefined();
      expect(
        crypto.createHash("sha256").update(payload).digest("hex"),
      ).toBe(digest);
    }
  });

  it("carries back the save and delete defaults Desktop set", () => {
    const settings = Object.fromEntries(
      rewritten.commonSemantics.portableSettings.map((row) => [
        row.key,
        row.value,
      ]),
    );
    expect(settings).toMatchObject({
      save_posts: true,
      save_likes: true,
      save_bookmarks: true,
      save_chats: true,
      delete_posts: true,
      delete_follows: false,
    });
  });

  it("carries no credentials, schedules, or local paths back out", () => {
    const database = Buffer.from(rewrittenEntries["data.db"]).toString("latin1");
    for (const forbidden of [
      "accessJwt",
      "refreshJwt",
      "oauth",
      "file:///",
      installation.root,
    ]) {
      expect(database.includes(forbidden)).toBe(false);
    }
  });

  /**
   * What Mobile cannot carry, asserted as absence rather than left unchecked.
   *
   * Each of these is a Mobile storage limitation listed in
   * `docs/bluesky-archive-fixtures.md`, not a contract failure — but an
   * unasserted loss is indistinguishable from a regression, so they are
   * pinned here. Fixing one of them is meant to fail this test.
   */
  describe("what a Mobile round trip loses, on purpose", () => {
    it("drops the mute, which Mobile has nowhere to keep", () => {
      expect(
        canonical.commonSemantics.relationships.map((row) => row.kind),
      ).toContain("mute");
      expect(
        rewritten.commonSemantics.relationships.map((row) => row.kind),
      ).not.toContain("mute");
    });

    it("collapses the captured historical profile into the current one", () => {
      expect(
        canonical.commonSemantics.profiles.filter(
          (row) => row.did === ACCOUNT_DID,
        ),
      ).toHaveLength(2);
      expect(
        rewritten.commonSemantics.profiles.filter(
          (row) => row.did === ACCOUNT_DID,
        ),
      ).toHaveLength(1);
    });

    it("says nothing about a profile description, which Mobile does not store", () => {
      expect(
        rewritten.commonSemantics.profiles.every(
          (row) => row.description === null,
        ),
      ).toBe(true);
    });

    it("says nothing about when Bluesky indexed a record", () => {
      expect(
        castRows(rewritten.commonSemantics.records).every(
          (row) => row.indexedAt === null,
        ),
      ).toBe(true);
    });

    it("has one observation time, so first and latest are the same", () => {
      expect(
        castRows(rewritten.commonSemantics.records).every(
          (row) => row.firstObservedAt === row.observedAt,
        ),
      ).toBe(true);
    });

    it("drops the bookmark record, which Mobile has no URI for", () => {
      // Mobile stores a bookmark as the post it points at, so there is no
      // bookmark record to write back — the selection names the post instead,
      // and there is no `record_subjects` row for it.
      expect(
        castRows(canonical.commonSemantics.records).map((row) => row.uri),
      ).toContain(BOOKMARK_RECORD);
      expect(
        castRows(rewritten.commonSemantics.records).map((row) => row.uri),
      ).not.toContain(BOOKMARK_RECORD);
      expect(
        rewritten.commonSemantics.selections.find(
          (row) => row.category === "bookmarks",
        ),
      ).toMatchObject({ subjectId: OWN_POST });
      expect(
        rewritten.commonSemantics.recordSubjects.map(
          (row) => row.relationshipUri,
        ),
      ).not.toContain(BOOKMARK_RECORD);
    });

    it("says nothing about a like's own CID, which Mobile does not store", () => {
      // `post.likeUri` has no CID beside it, unlike `post.repostCid`.
      expect(
        castRows(canonical.commonSemantics.records).find(
          (row) => row.uri === LIKE_RECORD,
        ),
      ).toMatchObject({ cid: "bafy-like" });
      expect(
        castRows(rewritten.commonSemantics.records).find(
          (row) => row.uri === LIKE_RECORD,
        ),
      ).toMatchObject({ cid: null });
    });

    it("leaves out save_reposts, which Mobile has no switch for", () => {
      expect(
        rewritten.commonSemantics.portableSettings.map((row) => row.key),
      ).not.toContain("save_reposts");
    });
  });
});

/**
 * An honestly incomplete Cyd Bluesky archive, all the way round.
 *
 * A structurally sound archive and a complete Bluesky backup are different
 * claims, and the difference has to survive a trip through Mobile in both
 * directions (#91): a missing asset that quietly disappeared on the way out
 * would turn an honest incomplete archive into a complete-looking lie, which
 * is worse than the missing file.
 */
contractDescribe("a canonical incomplete Desktop archive, rewritten by Mobile", () => {
  let trip: RoundTrip;

  beforeAll(async () => {
    trip = await roundTrip("incomplete", "incomplete.cyd");
  });

  afterAll(() => trip.installation.close());

  it("still says the backup is incomplete", () => {
    expect(trip.canonical.completeness).toBe("incomplete");
    expect(trip.rewritten.completeness).toBe("incomplete");
    expect(
      JSON.parse(Buffer.from(trip.entries["metadata.json"]).toString("utf8")),
    ).toMatchObject({ completeness: "incomplete" });
  });

  it("keeps the unavailable asset named, rather than dropping it", () => {
    const unavailable = trip.rewritten.assets.filter(
      (asset) => asset.availability !== "available",
    );
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]).toMatchObject({
      kind: "video",
      sha256: null,
      archivePath: null,
    });
    // Why it is missing is the part somebody can act on, so it survives too.
    expect(unavailable[0].unavailableReason).toEqual(expect.any(String));
  });

  it("carries back every record the incomplete archive still held", () => {
    const uris = (rows: Record<string, unknown>[]) =>
      rows
        .map((row) => row.uri as string)
        .filter((uri) => uri !== BOOKMARK_RECORD)
        .sort();
    expect(uris(castRows(trip.rewritten.commonSemantics.records))).toEqual(
      uris(castRows(trip.canonical.commonSemantics.records)),
    );
  });

  it("packages the assets it does have, with their bytes intact", () => {
    const available = trip.rewritten.assets.filter(
      (asset) => asset.availability === "available",
    );
    expect(available.length).toBeGreaterThan(0);
    for (const asset of available) {
      const payload = trip.entries[asset.archivePath as string];
      expect(payload).toBeDefined();
      expect(crypto.createHash("sha256").update(payload).digest("hex")).toBe(
        asset.sha256,
      );
    }
    expect(available.map((asset) => asset.sha256)).not.toContain(VIDEO_DIGEST);
  });
});

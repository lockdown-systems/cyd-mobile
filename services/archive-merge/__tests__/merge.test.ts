import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  buildTotalCountQuery,
  getTotalCountParams,
  type BrowseType,
} from "@/components/account/browse-shared";
import {
  runBlueskyArchiveIntake,
  type PreparedBlueskyArchive,
} from "@/services/archive-import";
import { restoreBlueskyArchiveAccount } from "@/services/archive-restore";
import { createMemoryByteReader } from "@/testUtils/archiveFixtures";
import {
  createDiskBlueskyArchiveIntakeEnvironment,
  createNodeBlueskyArchiveRestoreEnvironment,
  type NodeRestoreEnvironment,
} from "@/testUtils/archiveEnvironments";

import {
  commitBlueskyArchiveMerge,
  previewBlueskyArchiveMerge,
} from "../merge";
import { totalMergeChanges } from "../merge-plan";

/**
 * Importing a Cyd Bluesky archive into the Bluesky local account that already
 * holds its identity.
 *
 * The archive is the committed real-data fixture, and the account it merges
 * into is one this repo's own restore built out of that same fixture — so the
 * interesting cases are the ones a recovery actually meets: importing twice,
 * importing after somebody deleted things from Cyd, and importing over an
 * account whose settings and schedule are none of the archive's business.
 */

const FIXTURE_DIRECTORY = path.join(
  __dirname,
  "../../../testUtils/fixtures/bluesky-archive",
);
const ACCOUNT_DID = "did:plc:yn45xekh5kqrat27w6rmafcg";

jest.setTimeout(120_000);

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(FIXTURE_DIRECTORY, name)));
}

type Harness = {
  root: string;
  environment: NodeRestoreEnvironment;
  accountUuid: string;
  accountId: number;
  database: DatabaseSync;
  /** Stage a fixture again, the way a second import would. */
  prepare: (
    intakeId: string,
    name?: string,
  ) => Promise<PreparedBlueskyArchive>;
};

async function stage(
  root: string,
  intakeId: string,
  name = "complete.cyd",
): Promise<PreparedBlueskyArchive> {
  const outcome = await runBlueskyArchiveIntake(
    createDiskBlueskyArchiveIntakeEnvironment(path.join(root, "intake")),
    {
      intakeId,
      sourceUri: `file:///fixtures/${name}`,
      openReader: async () => createMemoryByteReader(fixtureBytes(name)),
    },
  );
  if (outcome.status !== "prepared") {
    throw new Error(`intake did not prepare ${name}: ${outcome.status}`);
  }
  return outcome;
}

/** An account restored from the fixture, ready to have the fixture merged in. */
async function restoredAccount(fixture = "complete.cyd"): Promise<Harness> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyd-merge-"));
  const environment = createNodeBlueskyArchiveRestoreEnvironment({
    root: path.join(root, "app"),
  });
  const prepared = await stage(root, "intake-restore", fixture);
  const restored = await restoreBlueskyArchiveAccount(environment, {
    archive: {
      intakeId: prepared.intakeId,
      stagingRoot: prepared.stagingRoot,
    },
  });

  return {
    root,
    environment,
    accountUuid: restored.accountUuid,
    accountId: restored.accountId,
    database: environment.openRestoredAccountDatabase(restored.accountUuid),
    prepare: (intakeId, name) => stage(root, intakeId, name),
  };
}

function browseCount(database: DatabaseSync, type: BrowseType): number {
  const row = database
    .prepare(buildTotalCountQuery(type))
    .get(...(getTotalCountParams(type, ACCOUNT_DID) as never[])) as {
    count: number;
  };
  return row.count;
}

function countRows(database: DatabaseSync, table: string): number {
  return (
    database.prepare(`SELECT COUNT(*) AS count FROM ${table};`).get() as {
      count: number;
    }
  ).count;
}

function identity(harness: Harness) {
  return {
    uuid: harness.accountUuid,
    did: ACCOUNT_DID,
    handle: "glittertop-cyd.bsky.social",
  };
}

async function mergeFixture(harness: Harness, intakeId: string) {
  const prepared = await harness.prepare(intakeId);
  const preview = await previewBlueskyArchiveMerge(harness.environment, {
    archive: {
      intakeId: prepared.intakeId,
      stagingRoot: prepared.stagingRoot,
    },
    account: identity(harness),
  });
  const result = await commitBlueskyArchiveMerge(harness.environment, preview);
  return { prepared, preview, result };
}

describe("merging a Cyd Bluesky archive into an account that holds its identity", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await restoredAccount();
  });

  afterAll(() => {
    harness.database.close();
    harness.environment.close();
    fs.rmSync(harness.root, { recursive: true, force: true });
  });

  it("changes nothing when the same archive is imported a second time", async () => {
    const before = {
      posts: browseCount(harness.database, "posts"),
      likes: browseCount(harness.database, "likes"),
      rows: countRows(harness.database, "post"),
      media: countRows(harness.database, "media_asset"),
    };

    const { preview, result } = await mergeFixture(harness, "intake-again");

    expect(preview.summary.restorations.total).toBe(0);
    expect(preview.summary.posts).toEqual({
      added: 0,
      updated: 0,
      unchanged: before.rows,
    });
    expect(result.written).toBe(0);
    expect({
      posts: browseCount(harness.database, "posts"),
      likes: browseCount(harness.database, "likes"),
      rows: countRows(harness.database, "post"),
      media: countRows(harness.database, "media_asset"),
    }).toEqual(before);
  });

  it("leaves no staging behind once the merge is committed", async () => {
    const { prepared } = await mergeFixture(harness, "intake-staging");

    expect(fs.existsSync(prepared.stagingRoot)).toBe(false);
  });

  it("brings back records the account no longer holds, counting them first", async () => {
    const doomed = (
      harness.database
        .prepare(
          `SELECT uri FROM post WHERE authorDid = ? ORDER BY uri LIMIT 3;`,
        )
        .all(ACCOUNT_DID) as { uri: string }[]
    ).map((row) => row.uri);
    const before = browseCount(harness.database, "posts");
    for (const uri of doomed) {
      harness.database.prepare("DELETE FROM post_media WHERE postUri = ?;").run(uri);
      harness.database.prepare("DELETE FROM post_external WHERE postUri = ?;").run(uri);
      harness.database.prepare("DELETE FROM post WHERE uri = ?;").run(uri);
    }
    expect(browseCount(harness.database, "posts")).toBe(before - doomed.length);

    const prepared = await harness.prepare("intake-restoration");
    const preview = await previewBlueskyArchiveMerge(harness.environment, {
      archive: {
        intakeId: prepared.intakeId,
        stagingRoot: prepared.stagingRoot,
      },
      account: identity(harness),
    });

    expect(preview.summary.restorations.total).toBe(doomed.length);
    // What the preview says out loud: three posts, and nothing else.
    expect(preview.summary.addedRecords).toMatchObject({
      posts: doomed.length,
      reposts: 0,
      likes: 0,
      messages: 0,
    });
    expect(
      preview.summary.restorations.records
        .map((record) => record.id)
        .sort(),
    ).toEqual([...doomed].sort());
    // Nothing is written until the restorations have been shown.
    expect(browseCount(harness.database, "posts")).toBe(before - doomed.length);

    await commitBlueskyArchiveMerge(harness.environment, preview);

    expect(browseCount(harness.database, "posts")).toBe(before);
  });

  it("keeps the account's own identifier, settings and schedule", async () => {
    const main = harness.environment.mainDatabase;
    main
      .prepare(
        `UPDATE bsky_account
         SET settingSavePosts = 0,
             settingDeleteLikes = 1,
             settingScheduleDeletion = 1,
             settingScheduleDeletionFrequency = 'monthly',
             settingScheduleDeletionTime = '07:30'
         WHERE id = (SELECT bskyAccountID FROM account WHERE uuid = ?);`,
      )
      .run(harness.accountUuid);
    const settingsBefore = main
      .prepare(
        `SELECT b.* FROM bsky_account b
         INNER JOIN account a ON a.bskyAccountID = b.id
         WHERE a.uuid = ?;`,
      )
      .get(harness.accountUuid);

    const { result } = await mergeFixture(harness, "intake-settings");

    expect(result.accountUuid).toBe(harness.accountUuid);
    expect(
      main
        .prepare(
          `SELECT b.* FROM bsky_account b
           INNER JOIN account a ON a.bskyAccountID = b.id
           WHERE a.uuid = ?;`,
        )
        .get(harness.accountUuid),
    ).toEqual(settingsBefore);
  });

  it("keeps a post the person chose to preserve", async () => {
    const [{ uri }] = harness.database
      .prepare(`SELECT uri FROM post ORDER BY uri LIMIT 1;`)
      .all() as { uri: string }[];
    harness.database
      .prepare("UPDATE post SET preserve = 1 WHERE uri = ?;")
      .run(uri);

    await mergeFixture(harness, "intake-preserve");

    expect(
      (
        harness.database
          .prepare("SELECT preserve FROM post WHERE uri = ?;")
          .get(uri) as { preserve: number }
      ).preserve,
    ).toBe(1);
  });

  it("refuses an archive belonging to a different Bluesky identity", async () => {
    const prepared = await harness.prepare("intake-mismatch");

    await expect(
      previewBlueskyArchiveMerge(harness.environment, {
        archive: {
          intakeId: prepared.intakeId,
          stagingRoot: prepared.stagingRoot,
        },
        account: {
          uuid: harness.accountUuid,
          did: "did:plc:somebody-else",
          handle: "somebody.bsky.social",
        },
      }),
    ).rejects.toThrow(/identity/i);
  });
});

/**
 * The recovery somebody actually performs: exporting again once a download
 * that had failed has finished, and importing that over the account the first
 * export built.
 *
 * The committed fixtures are exactly this pair — `incomplete.cyd` differs from
 * `complete.cyd` by one asset and nothing else — so this is the merge whose
 * only change is a file, and the one that used to describe itself as changing
 * nothing at all.
 */
describe("merging an archive carrying a file an earlier one could not", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await restoredAccount("incomplete.cyd");
  });

  afterAll(() => {
    harness.database.close();
    harness.environment.close();
    fs.rmSync(harness.root, { recursive: true, force: true });
  });

  function unavailable(): { contentCid: string; localPath: string | null }[] {
    return harness.database
      .prepare(
        `SELECT contentCid, localPath FROM media_asset
          WHERE downloadState != 'complete';`,
      )
      .all() as { contentCid: string; localPath: string | null }[];
  }

  it("recovers the file, and counts it as a change", async () => {
    const missing = unavailable();
    expect(missing).toHaveLength(1);

    const prepared = await harness.prepare("intake-upgrade", "complete.cyd");
    const preview = await previewBlueskyArchiveMerge(harness.environment, {
      archive: {
        intakeId: prepared.intakeId,
        stagingRoot: prepared.stagingRoot,
      },
      account: identity(harness),
    });

    // Every record is identical across the pair, so a summary read one table
    // at a time finds nothing: the file is the whole of the difference.
    expect(preview.summary.posts).toMatchObject({ added: 0, updated: 0 });
    expect(preview.summary.messages).toMatchObject({ added: 0, updated: 0 });
    expect(preview.summary.mediaAssets).toMatchObject({ added: 0, updated: 1 });
    expect(totalMergeChanges(preview.summary)).toMatchObject({
      records: { added: 0, updated: 0 },
      files: { added: 0, updated: 1 },
      total: 1,
    });
    // Nothing to say about any kind of record: the file is the whole of it.
    expect(preview.summary.addedRecords).toEqual({
      posts: 0,
      reposts: 0,
      likes: 0,
      bookmarks: 0,
      follows: 0,
      chats: 0,
      messages: 0,
    });

    const result = await commitBlueskyArchiveMerge(harness.environment, preview);

    expect(result.written).toBe(1);
    expect(unavailable()).toEqual([]);

    const restored = harness.database
      .prepare("SELECT localPath FROM media_asset WHERE contentCid = ?;")
      .get(missing[0].contentCid) as { localPath: string | null };
    expect(restored.localPath).not.toBeNull();
    expect(
      fs.existsSync(restored.localPath!.replace(/^file:\/\//, "")),
    ).toBe(true);
  });
});

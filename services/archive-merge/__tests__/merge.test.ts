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
  /** Stage the fixture again, the way a second import would. */
  prepare: (intakeId: string) => Promise<PreparedBlueskyArchive>;
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
async function restoredAccount(): Promise<Harness> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyd-merge-"));
  const environment = createNodeBlueskyArchiveRestoreEnvironment({
    root: path.join(root, "app"),
  });
  const prepared = await stage(root, "intake-restore");
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
    prepare: (intakeId) => stage(root, intakeId),
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

  it("brings back records deleted from Cyd, and names them before committing", async () => {
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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

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
  findDuplicateBlueskyIdentities,
  previewDuplicateReconciliation,
  reconcileDuplicateBlueskyAccounts,
} from "../duplicates";

/**
 * Collapsing a Bluesky identity this installation holds twice (ADR 0011).
 *
 * Duplicates are the state an archive import cannot route around: with two
 * Bluesky local accounts for one DID there is no unambiguous destination, so
 * the person is shown both and says which one survives and whose settings it
 * keeps. What must come out the other side is one account, holding the union
 * of both, under an identifier they chose.
 */

const FIXTURE_DIRECTORY = path.join(
  __dirname,
  "../../../testUtils/fixtures/bluesky-archive",
);
const ACCOUNT_DID = "did:plc:yn45xekh5kqrat27w6rmafcg";
const ORPHAN_URI = "at://did:plc:yn45xekh5kqrat27w6rmafcg/app.bsky.feed.post/only-on-the-other-one";

jest.setTimeout(120_000);

type Harness = {
  root: string;
  environment: NodeRestoreEnvironment;
  survivor: { uuid: string; id: number };
  duplicate: { uuid: string; id: number };
};

async function stage(root: string): Promise<PreparedBlueskyArchive> {
  const outcome = await runBlueskyArchiveIntake(
    createDiskBlueskyArchiveIntakeEnvironment(path.join(root, "intake")),
    {
      intakeId: "intake-1",
      sourceUri: "file:///fixtures/complete.cyd",
      openReader: async () =>
        createMemoryByteReader(
          new Uint8Array(
            fs.readFileSync(path.join(FIXTURE_DIRECTORY, "complete.cyd")),
          ),
        ),
    },
  );
  if (outcome.status !== "prepared") {
    throw new Error(`intake did not prepare: ${outcome.status}`);
  }
  return outcome;
}

/**
 * One identity, two Bluesky local accounts: a restored one, and a second the
 * person built up separately, holding a post and a file the first never saw.
 */
async function twoAccountsForOneIdentity(): Promise<Harness> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyd-duplicates-"));
  const environment = createNodeBlueskyArchiveRestoreEnvironment({
    root: path.join(root, "app"),
  });
  const prepared = await stage(root);
  const restored = await restoreBlueskyArchiveAccount(environment, {
    archive: {
      intakeId: prepared.intakeId,
      stagingRoot: prepared.stagingRoot,
    },
  });

  // Mobile's own schema will not hold two accounts for one DID, so the state
  // this reconciliation exists for has to be built the way it would arrive:
  // from a database that predates the rule.
  environment.mainDatabase.exec("DROP INDEX IF EXISTS idx_bsky_account_did;");

  const duplicate = await environment.createLocalAccount({
    uuid: "11111111-2222-4333-8444-555555555555",
    did: ACCOUNT_DID,
    handle: ACCOUNT_DID,
    displayName: "The other copy",
    avatarUrl: null,
    settings: { settingSavePosts: 0, settingDeleteLikes: 1 },
  });

  const database = environment.openRestoredAccountDatabase(duplicate.accountUuid);
  const stored = await environment.storeAccountMedia(
    duplicate.accountUuid,
    "sha256-onlyontheotherone",
    async (push) => push(new Uint8Array([1, 2, 3, 4])),
  );
  database
    .prepare(
      `INSERT INTO profile (did, handle, displayName, avatarUrl, savedAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?);`,
    )
    .run(ACCOUNT_DID, "glittertop-cyd.bsky.social", null, null, 10, 10);
  database
    .prepare(
      `INSERT INTO media_asset (
         contentCid, mediaType, mimeType, byteLength, localPath, sourceUrl,
         downloadState, attemptCount, downloadedAt
       ) VALUES (?, 'image', 'image/jpeg', 4, ?, 'https://cdn.example/one.jpg', 'complete', 0, 10);`,
    )
    .run("bafy-only-on-the-other-one", stored.uri);
  database
    .prepare(
      `INSERT INTO post (
         uri, cid, authorDid, text, isReply, isQuote, isRepost,
         likeCount, repostCount, replyCount, quoteCount,
         viewerLiked, viewerReposted, viewerBookmarked,
         createdAt, savedAt, preserve
       ) VALUES (?, 'cid-other', ?, 'only on the other copy', 0, 0, 0,
                 0, 0, 0, 0, 0, 0, 0, '2026-02-02T00:00:00.000Z', 10, 1);`,
    )
    .run(ORPHAN_URI, ACCOUNT_DID);
  database.close();

  return {
    root,
    environment,
    survivor: { uuid: restored.accountUuid, id: restored.accountId },
    duplicate: { uuid: duplicate.accountUuid, id: duplicate.accountId },
  };
}

function accountRow(
  main: DatabaseSync,
  accountUuid: string,
): Record<string, unknown> | undefined {
  return main
    .prepare(
      `SELECT b.* FROM bsky_account b
       INNER JOIN account a ON a.bskyAccountID = b.id
       WHERE a.uuid = ?;`,
    )
    .get(accountUuid) ?? undefined;
}

describe("reconciling a Bluesky identity held by two local accounts", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await twoAccountsForOneIdentity();
  });

  afterAll(() => {
    harness.environment.close();
    fs.rmSync(harness.root, { recursive: true, force: true });
  });

  it("flags the duplicates rather than picking one", async () => {
    const duplicates = findDuplicateBlueskyIdentities(
      await harness.environment.listLocalAccountIdentities(),
    );

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].did).toBe(ACCOUNT_DID);
    expect(duplicates[0].accounts.map((account) => account.uuid).sort()).toEqual(
      [harness.duplicate.uuid, harness.survivor.uuid].sort(),
    );
  });

  it("previews what each local account holds and is set to do", async () => {
    const preview = await previewDuplicateReconciliation(harness.environment, {
      did: ACCOUNT_DID,
      accounts: await harness.environment.listLocalAccountIdentities(),
    });

    const other = preview.accounts.find(
      (account) => account.uuid === harness.duplicate.uuid,
    );
    expect(other).toMatchObject({
      uuid: harness.duplicate.uuid,
      counts: { posts: 1, profiles: 1 },
      settings: { settingSavePosts: 0, settingDeleteLikes: 1 },
    });
    expect(
      preview.accounts.find(
        (account) => account.uuid === harness.survivor.uuid,
      )?.counts.posts,
    ).toBeGreaterThan(1);
  });

  it("keeps the identifier and settings the person chose, and unions the rest", async () => {
    const main = harness.environment.mainDatabase;
    const before = accountRow(main, harness.survivor.uuid);

    const result = await reconcileDuplicateBlueskyAccounts(harness.environment, {
      did: ACCOUNT_DID,
      accounts: await harness.environment.listLocalAccountIdentities(),
      survivingUuid: harness.survivor.uuid,
      settingsFromUuid: harness.duplicate.uuid,
    });

    expect(result.survivingUuid).toBe(harness.survivor.uuid);
    expect(result.removedUuids).toEqual([harness.duplicate.uuid]);

    const database = harness.environment.openRestoredAccountDatabase(
      harness.survivor.uuid,
    );
    const adopted = database
      .prepare("SELECT preserve, text FROM post WHERE uri = ?;")
      .get(ORPHAN_URI) as { preserve: number; text: string } | undefined;
    const asset = database
      .prepare("SELECT localPath FROM media_asset WHERE contentCid = ?;")
      .get("bafy-only-on-the-other-one") as { localPath: string } | undefined;
    database.close();

    expect(adopted).toMatchObject({
      text: "only on the other copy",
      preserve: 1,
    });
    // The file moved with the record, into the surviving account's own storage.
    expect(asset?.localPath).toContain(
      `bluesky-${harness.survivor.uuid}`,
    );
    expect(fs.existsSync(asset!.localPath.replace("file://", ""))).toBe(true);

    // The settings came from the account whose settings were chosen; the
    // surviving account's own identifier did not move.
    const after = accountRow(main, harness.survivor.uuid);
    expect(after).toMatchObject({
      settingSavePosts: 0,
      settingDeleteLikes: 1,
      did: ACCOUNT_DID,
      handle: before?.handle,
    });
  });

  it("leaves one Bluesky local account for the identity, and nothing to reconcile", async () => {
    const identities = await harness.environment.listLocalAccountIdentities();

    expect(
      identities.filter((account) => account.did === ACCOUNT_DID),
    ).toHaveLength(1);
    expect(findDuplicateBlueskyIdentities(identities)).toEqual([]);
    expect(
      fs.existsSync(harness.environment.accountDirectory(harness.duplicate.uuid)),
    ).toBe(false);

    // And the rule is back on, so the installation cannot drift into holding
    // the identity twice again.
    expect(() =>
      harness.environment.mainDatabase
        .prepare(
          `INSERT INTO bsky_account (createdAt, updatedAt, accessedAt, handle, postsCount, did)
           VALUES (1, 1, 1, 'another.bsky.social', 0, ?);`,
        )
        .run(ACCOUNT_DID),
    ).toThrow(/UNIQUE/i);
  });

  it("refuses to keep an account that is not one of the duplicates", async () => {
    await expect(
      reconcileDuplicateBlueskyAccounts(harness.environment, {
        did: ACCOUNT_DID,
        accounts: await harness.environment.listLocalAccountIdentities(),
        survivingUuid: "99999999-9999-4999-8999-999999999999",
        settingsFromUuid: harness.survivor.uuid,
      }),
    ).rejects.toThrow(/account/i);
  });
});

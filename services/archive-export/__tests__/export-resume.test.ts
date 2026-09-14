import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createNodeBlueskyArchiveExportEnvironment } from "@/scripts/dev/node-export-environment";
import {
  ACCOUNT_DID,
  ACCOUNT_UUID,
  POST_URI,
  addMedia,
  createAccount,
  openArchive,
  run,
  seedAccount,
  type Account,
} from "@/testUtils/blueskyExportAccount";

import {
  discardBlueskyArchiveExport,
  listResumableBlueskyArchiveExports,
} from "../checkpoint";
import { BlueskyArchiveExportCancelled } from "../errors";
import { runBlueskyArchiveExport } from "../export";
import type { BlueskyArchiveExportEnvironment } from "../ports";

/**
 * An export that the operating system interrupts, picked up on the next launch.
 *
 * The property worth protecting is not speed: it is that a resumed export is
 * still the export that was started. The moment an archive describes is taken
 * once (ADR 0010), so everything staged under that moment survives a restart,
 * and work that happened to the account in between stays out of the archive
 * however many launches it takes to finish.
 */

const PORTABLE_SETTINGS = {
  save_posts: true,
  save_likes: true,
  delete_posts: false,
};

type Interruption = keyof BlueskyArchiveExportEnvironment;

type TestEnvironment = BlueskyArchiveExportEnvironment & {
  /** How many times each file was read, by its last path segment. */
  reads: Map<string, number>;
  snapshots: number;
};

function createTestEnvironment(options: {
  account: Account;
  stagingRoot: string;
  now: string;
  /** A port that fails once, standing in for the app being killed. */
  breakAt?: Interruption;
  /** Runs before a file is read, so a test can move it underneath the export. */
  beforeRead?: (name: string, reads: number) => void;
  shouldCancel?: () => boolean;
}): TestEnvironment {
  const reads = new Map<string, number>();
  const environment = createNodeBlueskyArchiveExportEnvironment({
    accountDirectory: options.account.directory,
    stagingRoot: options.stagingRoot,
    now: () => new Date(options.now),
  });

  const test: TestEnvironment = {
    ...environment,
    reads,
    snapshots: 0,
    async snapshotAccountDatabase(staging, relativePath) {
      test.snapshots += 1;
      await environment.snapshotAccountDatabase(staging, relativePath);
    },
    async readFile(location, onBytes) {
      const name = location.slice(location.lastIndexOf("/") + 1);
      const count = (reads.get(name) ?? 0) + 1;
      reads.set(name, count);
      options.beforeRead?.(name, count);
      await environment.readFile(location, onBytes);
    },
  };

  if (options.breakAt) {
    const port = options.breakAt;
    Object.assign(test, {
      [port]: () => {
        throw new Error("the operating system reclaimed Cyd");
      },
    });
  }
  return test;
}

function exportRequest() {
  return {
    exportId: "export-1",
    accountUuid: ACCOUNT_UUID,
    accountDid: ACCOUNT_DID,
    accountHandle: "alice.example",
    portableSettings: PORTABLE_SETTINGS,
  };
}

describe("resuming a Cyd Bluesky archive export", () => {
  let root: string;
  let workspace: string;
  let stagingRoot: string;
  let account: Account;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cyd-account-"));
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cyd-export-test-"));
    stagingRoot = path.join(workspace, "staging");
    account = createAccount(root);
    seedAccount(account);
    addMedia(account, {
      contentCid: "bafyimage",
      postUri: POST_URI,
      position: 0,
      fileName: "bafyimage",
      contents: "image bytes",
    });
  });

  afterEach(() => {
    account.database.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("carries on from what an interrupted run staged, at the moment it staged it", async () => {
    const interrupted = createTestEnvironment({
      account,
      stagingRoot,
      now: "2026-09-10T00:00:00.000Z",
      breakAt: "createBlueskyInterchangeDatabase",
    });
    await expect(
      runBlueskyArchiveExport(interrupted, exportRequest()),
    ).rejects.toThrow("reclaimed");

    // Saving carries on between the two launches, as it would on a phone.
    run(
      account.database,
      `INSERT INTO post (uri, cid, authorDid, text, isReply, isQuote, isRepost,
                         likeCount, repostCount, replyCount, quoteCount,
                         viewerLiked, viewerReposted, viewerBookmarked,
                         createdAt, savedAt)
       VALUES (?, 'bafylater', ?, 'Saved between launches', 0, 0, 0,
               0, 0, 0, 0, 0, 0, 0, '2026-09-11T09:00:00.000Z', ?);`,
      [`at://${ACCOUNT_DID}/app.bsky.feed.post/later`, ACCOUNT_DID, Date.now()],
    );

    const resumed = createTestEnvironment({
      account,
      stagingRoot,
      now: "2026-09-12T00:00:00.000Z",
    });
    const result = await runBlueskyArchiveExport(resumed, exportRequest());
    const archive = openArchive(result.location, workspace);

    // The account database is copied once, under the pause that made the
    // snapshot a point in time. A resumed export inherits that moment.
    expect(resumed.snapshots).toBe(0);
    expect(archive.metadata.createdAt).toBe("2026-09-10T00:00:00.000Z");
    expect(
      archive.database.prepare("SELECT uri FROM records ORDER BY uri").all(),
    ).not.toContainEqual({
      uri: `at://${ACCOUNT_DID}/app.bsky.feed.post/later`,
    });

    // Hashing every preserved file is the pass an interrupted export must not
    // pay for twice: the resumed run reads the image to package it, and not
    // again to work out a digest it already has.
    expect(resumed.reads.get("bafyimage")).toBe(1);
    expect(archive.database.prepare("SELECT availability FROM assets").all()).toContainEqual(
      { availability: "available" },
    );
  });

  it("builds the archive around a file that moved while it was being packaged", async () => {
    // Hashing reads the image first, packaging second. Rewriting it in between
    // is a save job replacing a preserved file after the inventory saw it.
    const environment = createTestEnvironment({
      account,
      stagingRoot,
      now: "2026-09-10T00:00:00.000Z",
      beforeRead: (name, reads) => {
        if (name === "bafyimage" && reads === 2) {
          fs.writeFileSync(
            path.join(account.mediaDirectory, "bafyimage"),
            "different bytes",
          );
        }
      },
    });

    const result = await runBlueskyArchiveExport(environment, exportRequest());
    const archive = openArchive(result.location, workspace);

    // The export finishes, and says what happened to the file it could not
    // package rather than failing over it.
    expect(archive.metadata.completeness).toBe("incomplete");
    expect(
      archive.database
        .prepare("SELECT availability, unavailable_reason FROM assets WHERE id = 'bafyimage'")
        .get(),
    ).toEqual({
      availability: "unavailable",
      unavailable_reason:
        "The preserved file changed while the export was being prepared.",
    });
    // Nothing of it is in the archive: no bytes, and nowhere claiming to hold
    // them. The link preview beside it is packaged as usual.
    expect(
      archive.database
        .prepare("SELECT archive_path FROM assets WHERE id = 'bafyimage'")
        .get(),
    ).toEqual({ archive_path: null });
    expect(
      Object.keys(archive.entries).filter((name) => name.startsWith("media/")),
    ).toHaveLength(1);
    expect(result.assets).toEqual({
      total: 2,
      available: 1,
      missing: 0,
      unavailable: 1,
    });
  });

  it("offers the finished archive again rather than building it twice", async () => {
    const first = createTestEnvironment({
      account,
      stagingRoot,
      now: "2026-09-10T00:00:00.000Z",
    });
    const finished = await runBlueskyArchiveExport(first, exportRequest());

    // Killed after packaging but before the archive was handed over, which is
    // the whole of what the share sheet's lifetime is.
    const second = createTestEnvironment({
      account,
      stagingRoot,
      now: "2026-09-12T00:00:00.000Z",
    });
    const again = await runBlueskyArchiveExport(second, exportRequest());

    expect(again).toMatchObject({
      location: finished.location,
      fileName: finished.fileName,
      byteLength: finished.byteLength,
      assets: finished.assets,
    });
    expect(again.metadata.createdAt).toBe("2026-09-10T00:00:00.000Z");
    // Nothing was read a second time: the archive on disk is the answer.
    expect(second.reads.size).toBe(0);
    expect(second.snapshots).toBe(0);
  });

  it("takes its staging with it when somebody walks away", async () => {
    const environment = createTestEnvironment({
      account,
      stagingRoot,
      now: "2026-09-10T00:00:00.000Z",
    });

    await expect(
      runBlueskyArchiveExport(environment, {
        ...exportRequest(),
        shouldCancel: () => true,
      }),
    ).rejects.toBeInstanceOf(BlueskyArchiveExportCancelled);

    // Cancelling is the one interruption that is final, so there is nothing
    // for a later launch to find.
    expect(listResumableBlueskyArchiveExports(environment)).toEqual([]);
  });

  it("keeps nothing staged for a failure that would only happen again", async () => {
    const environment = createTestEnvironment({
      account,
      stagingRoot,
      now: "2026-09-10T00:00:00.000Z",
    });
    // A snapshot Cyd cannot read back is not a device problem waiting to clear.
    environment.snapshotAccountDatabase = async (staging, relativePath) => {
      staging.writeText(relativePath, "not a database");
    };

    await expect(
      runBlueskyArchiveExport(environment, exportRequest()),
    ).rejects.toThrow(/could not/);

    expect(listResumableBlueskyArchiveExports(environment)).toEqual([]);
  });

  it("reports what an interrupted launch left, and throws it away on request", async () => {
    const interrupted = createTestEnvironment({
      account,
      stagingRoot,
      now: "2026-09-10T00:00:00.000Z",
      breakAt: "createBlueskyInterchangeDatabase",
    });
    await expect(
      runBlueskyArchiveExport(interrupted, exportRequest()),
    ).rejects.toThrow("reclaimed");

    expect(listResumableBlueskyArchiveExports(interrupted)).toEqual([
      expect.objectContaining({
        exportId: "export-1",
        accountUuid: ACCOUNT_UUID,
        accountDid: ACCOUNT_DID,
        accountHandle: "alice.example",
        phase: "translating",
        hashedAssets: 2,
        totalAssets: 2,
      }),
    ]);

    discardBlueskyArchiveExport(interrupted, "export-1");

    expect(listResumableBlueskyArchiveExports(interrupted)).toEqual([]);
  });
});

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  buildFirstPageQuery,
  buildTotalCountQuery,
  getFirstPageParams,
  getTotalCountParams,
  type BrowseType,
} from "@/components/account/browse-shared";
import { ACCOUNT_AUTH_STATUS, ACCOUNT_CONFIG_KEYS } from "@/controllers/config";
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
} from "@/testUtils/restoreFixtures";

/**
 * Restoring the committed real-data fixtures into a browseable account.
 *
 * The seam here is the one #91 asks for: a Cyd Bluesky archive goes in, and
 * what comes out is asserted through Mobile's own browse queries and the files
 * on disk, not through the shape of the rows in between. If a later change
 * moves a column but keeps the account browseable, these tests should not
 * care; if it quietly loses somebody's likes, they should fail.
 *
 * The account behind the fixtures is documented in
 * `testUtils/fixtures/bluesky-archive/README.md`.
 */

const FIXTURE_DIRECTORY = path.join(
  __dirname,
  "../../../testUtils/fixtures/bluesky-archive",
);
const ACCOUNT_DID = "did:plc:yn45xekh5kqrat27w6rmafcg";
const ACCOUNT_HANDLE = "glittertop-cyd.bsky.social";
const ARCHIVE_UUID = "b67bfc6c-6155-47ef-8273-71593e04f01a";

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(FIXTURE_DIRECTORY, name)));
}

type Harness = {
  root: string;
  environment: NodeRestoreEnvironment;
  prepared: PreparedBlueskyArchive;
};

async function prepare(name: string): Promise<Harness> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyd-restore-"));
  const outcome = await runBlueskyArchiveIntake(
    createDiskBlueskyArchiveIntakeEnvironment(path.join(root, "intake")),
    {
      intakeId: "intake-1",
      sourceUri: `file:///fixtures/${name}`,
      openReader: async () => createMemoryByteReader(fixtureBytes(name)),
    },
  );
  if (outcome.status !== "prepared") {
    throw new Error(`intake did not prepare ${name}: ${outcome.status}`);
  }

  return {
    root,
    environment: createNodeBlueskyArchiveRestoreEnvironment({
      root: path.join(root, "app"),
    }),
    prepared: outcome,
  };
}

function browseCount(
  database: DatabaseSync,
  type: BrowseType,
  did = ACCOUNT_DID,
): number {
  const row = database
    .prepare(buildTotalCountQuery(type))
    .get(...(getTotalCountParams(type, did) as never[])) as { count: number };
  return row.count;
}

function browseFirstPage(
  database: DatabaseSync,
  type: BrowseType,
  did = ACCOUNT_DID,
): Record<string, unknown>[] {
  return database
    .prepare(buildFirstPageQuery(type))
    .all(...(getFirstPageParams(type, did) as never[])) as Record<
    string,
    unknown
  >[];
}

describe("restoring a complete Cyd Bluesky archive", () => {
  let harness: Harness;
  let account: Awaited<ReturnType<typeof restoreBlueskyArchiveAccount>>;
  let database: DatabaseSync;

  beforeAll(async () => {
    harness = await prepare("complete.cyd");
    account = await restoreBlueskyArchiveAccount(harness.environment, {
      archive: {
        intakeId: harness.prepared.intakeId,
        stagingRoot: harness.prepared.stagingRoot,
      },
    });
    database = harness.environment.openRestoredAccountDatabase(
      account.accountUuid,
    );
  });

  afterAll(() => {
    database.close();
    harness.environment.close();
    fs.rmSync(harness.root, { recursive: true, force: true });
  });

  it("adopts the archive's own local-account UUID", () => {
    expect(account.accountUuid).toBe(ARCHIVE_UUID);
    expect(account.uuidRemapping).toBeNull();
    expect(account.accountDid).toBe(ACCOUNT_DID);
    expect(account.handle).toBe(ACCOUNT_HANDLE);
  });

  it("browses every category the archive selected", () => {
    expect(browseCount(database, "posts")).toBe(16);
    expect(browseCount(database, "reposts")).toBe(2);
    expect(browseCount(database, "likes")).toBe(1);
    expect(browseCount(database, "bookmarks")).toBe(0);
    expect(account.counts).toMatchObject({
      posts: 16,
      reposts: 2,
      likes: 1,
      chats: 1,
      messages: 7,
    });
  });

  it("restores each record's latest observed representation", () => {
    const posts = browseFirstPage(database, "posts");
    const newest = posts[0];

    expect(newest).toMatchObject({
      uri: `at://${ACCOUNT_DID}/app.bsky.feed.post/3mv73nmoa4h2t`,
      text: "Counter-point to consider",
      authorDid: ACCOUNT_DID,
      handle: ACCOUNT_HANDLE,
      // Browse reads the quote target straight off the restored row.
      quotedPostUri: expect.stringContaining("app.bsky.feed.post/"),
    });
    expect(newest.cid).toBe(
      "bafyreignh3esnhw76kubnoii7dl2qkoifosqqxyusiiozuggmekid3tis4",
    );
    // The embed a quote renders from is Bluesky's own, carried through the
    // archive rather than rebuilt from a live lookup.
    expect(JSON.parse(newest.embedJSON as string)).toMatchObject({
      record: { uri: expect.stringContaining("app.bsky.feed.post/") },
    });
  });

  it("restores the captured authors, including one known only by its DID", () => {
    const profiles = database
      .prepare("SELECT did, handle, displayName FROM profile ORDER BY did;")
      .all() as { did: string; handle: string }[];

    expect(profiles).toHaveLength(3);
    expect(profiles.map((profile) => profile.handle)).toEqual([
      "aurorabyte-cyd.bsky.social",
      ACCOUNT_HANDLE,
      // A profile the archive carries with no handle keeps its DID, which is
      // what the archive actually knows about that identity.
      "did:plc:z72i7hdynmk6r22z27h6tvur",
    ]);
  });

  it("restores the bounded context a quote needs to render offline", () => {
    const quotes = database
      .prepare(
        `SELECT uri, quotedPostUri FROM post WHERE isQuote = 1 ORDER BY uri;`,
      )
      .all() as { uri: string; quotedPostUri: string }[];

    expect(quotes).toHaveLength(3);
    for (const quote of quotes) {
      expect(quote.quotedPostUri).toMatch(/^at:\/\/did:plc:/);
    }
  });

  it("restores chats, their members, and the messages inside them", () => {
    const conversation = database
      .prepare(
        `SELECT convoId, memberDids, lastMessageText, lastMessageSenderDid
         FROM conversation;`,
      )
      .get() as {
      convoId: string;
      memberDids: string;
      lastMessageText: string;
    };

    expect(conversation.convoId).toBe("3mv73tvqiah2e");
    expect(JSON.parse(conversation.memberDids)).toEqual([
      "did:plc:2bms7m4ifky3vdiyvx4ifl2l",
      ACCOUNT_DID,
    ]);
    expect(conversation.lastMessageText).toBeTruthy();

    const messages = database
      .prepare(
        `SELECT m.messageId, m.text, p.handle
         FROM message m
         LEFT JOIN profile p ON p.did = m.senderDid
         ORDER BY m.sentAt;`,
      )
      .all() as { text: string; handle: string }[];

    expect(messages).toHaveLength(7);
    expect(messages[0].handle).toBe(ACCOUNT_HANDLE);
  });

  it("stores every image once, content-addressably, inside the account", () => {
    const mediaDirectory = path.join(
      harness.environment.accountDirectory(account.accountUuid),
      "media",
    );
    const files = fs.readdirSync(mediaDirectory).sort();

    // Five assets, six references: the archive packages each file once, and so
    // does the account it is restored into (ADR 0007).
    expect(files).toHaveLength(5);
    expect(account.assets).toEqual({ total: 5, restored: 5, missing: 0 });
    expect(
      (
        database
          .prepare("SELECT COUNT(*) AS n FROM post_media;")
          .get() as { n: number }
      ).n,
    ).toBe(6);

    for (const file of files) {
      const digest = crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(mediaDirectory, file)))
        .digest("hex");
      expect(file).toBe(`sha256-${digest}`);
    }
  });

  it("points saved media at the local file so it renders without a network", () => {
    const assets = database
      .prepare(
        `SELECT contentCid, localPath, downloadState, lastError, byteLength
         FROM media_asset ORDER BY contentCid;`,
      )
      .all() as {
      localPath: string;
      downloadState: string;
      lastError: string | null;
    }[];

    expect(assets).toHaveLength(5);
    for (const asset of assets) {
      expect(asset.downloadState).toBe("complete");
      expect(asset.lastError).toBeNull();
      expect(fs.existsSync(asset.localPath.replace("file://", ""))).toBe(true);
    }
  });

  it("clears the staging the archive was prepared into", () => {
    // The account holds the data now; a second copy in staging would be both
    // wasted space and an import that still looks resumable.
    expect(fs.existsSync(harness.prepared.stagingRoot)).toBe(false);
  });

  it("records that the restored backup is complete", () => {
    expect(account.completeness).toBe("complete");
    expect(config(database, ACCOUNT_CONFIG_KEYS.restoredArchiveCompleteness)).toBe(
      "complete",
    );
    expect(config(database, ACCOUNT_CONFIG_KEYS.restoredArchiveUuid)).toBe(
      ARCHIVE_UUID,
    );
  });

  it("leaves the account disconnected, with no credentials and no schedule", () => {
    expect(config(database, ACCOUNT_CONFIG_KEYS.authStatus)).toBe(
      ACCOUNT_AUTH_STATUS.signedOut,
    );

    const row = harness.environment.mainDatabase
      .prepare(
        `SELECT b.settingScheduleDeletion, b.did, b.handle
         FROM bsky_account b
         INNER JOIN account a ON a.bskyAccountID = b.id
         WHERE a.uuid = ?;`,
      )
      .get(ARCHIVE_UUID) as {
      settingScheduleDeletion: number;
      did: string;
      handle: string;
    };

    expect(row).toMatchObject({ did: ACCOUNT_DID, handle: ACCOUNT_HANDLE });
    expect(row.settingScheduleDeletion).toBe(0);
  });

  it("applies the archive's save and delete settings as the new account's defaults", () => {
    const settings = harness.environment.mainDatabase
      .prepare(
        `SELECT b.settingSavePosts, b.settingSaveChats, b.settingDeletePosts,
                b.settingDeleteBookmarks, b.settingDeleteUnfollowEveryone
         FROM bsky_account b
         INNER JOIN account a ON a.bskyAccountID = b.id
         WHERE a.uuid = ?;`,
      )
      .get(ARCHIVE_UUID);

    expect(settings).toEqual({
      settingSavePosts: 1,
      settingSaveChats: 1,
      settingDeletePosts: 1,
      settingDeleteBookmarks: 0,
      settingDeleteUnfollowEveryone: 0,
    });
  });
});

describe("restoring an incomplete Cyd Bluesky archive", () => {
  it("keeps every recoverable record and leaves the missing asset explicit", async () => {
    const harness = await prepare("incomplete.cyd");
    const account = await restoreBlueskyArchiveAccount(harness.environment, {
      archive: {
        intakeId: harness.prepared.intakeId,
        stagingRoot: harness.prepared.stagingRoot,
      },
    });
    const database = harness.environment.openRestoredAccountDatabase(
      account.accountUuid,
    );

    expect(account.completeness).toBe("incomplete");
    expect(account.assets).toEqual({ total: 5, restored: 4, missing: 1 });
    // Everything the pair shares survives: an asset nobody could package must
    // not cost the account the records that reference it.
    expect(browseCount(database, "posts")).toBe(16);
    expect(browseCount(database, "reposts")).toBe(2);
    expect(browseCount(database, "likes")).toBe(1);

    const missing = database
      .prepare(
        `SELECT contentCid, localPath, downloadState, lastError, sourceUrl
         FROM media_asset WHERE downloadState != 'complete';`,
      )
      .all() as {
      localPath: string | null;
      lastError: string;
      sourceUrl: string;
    }[];

    expect(missing).toHaveLength(1);
    expect(missing[0].localPath).toBeNull();
    expect(missing[0].lastError).toBeTruthy();
    // Retryable: the record still knows where the file came from.
    expect(missing[0].sourceUrl).toContain("https://");
    // And the reference from the post it belongs to is still there.
    expect(
      (
        database
          .prepare("SELECT COUNT(*) AS n FROM post_media;")
          .get() as { n: number }
      ).n,
    ).toBe(6);
    expect(
      config(database, ACCOUNT_CONFIG_KEYS.restoredArchiveCompleteness),
    ).toBe("incomplete");

    database.close();
    harness.environment.close();
    fs.rmSync(harness.root, { recursive: true, force: true });
  });
});

describe("restoring into an installation that is already using the UUID", () => {
  it("remaps the local-account UUID and reports the remapping", async () => {
    const harness = await prepare("complete.cyd");
    // Another Bluesky identity already holds the UUID this archive carries.
    harness.environment.mainDatabase
      .prepare(
        `INSERT INTO bsky_account (createdAt, updatedAt, handle, did)
         VALUES (1, 1, 'someone-else.bsky.social', 'did:plc:somebodyelse');`,
      )
      .run();
    harness.environment.mainDatabase
      .prepare(
        `INSERT INTO account (uuid, sortOrder, type, bskyAccountID)
         VALUES (?, 0, 'bluesky', 1);`,
      )
      .run(ARCHIVE_UUID);

    const account = await restoreBlueskyArchiveAccount(harness.environment, {
      archive: {
        intakeId: harness.prepared.intakeId,
        stagingRoot: harness.prepared.stagingRoot,
      },
    });

    expect(account.accountUuid).not.toBe(ARCHIVE_UUID);
    expect(account.uuidRemapping).toMatchObject({
      archiveUuid: ARCHIVE_UUID,
      assignedUuid: account.accountUuid,
    });
    // The unrelated identity is untouched, and the restored one is browseable.
    const database = harness.environment.openRestoredAccountDatabase(
      account.accountUuid,
    );
    expect(browseCount(database, "posts")).toBe(16);

    database.close();
    harness.environment.close();
    fs.rmSync(harness.root, { recursive: true, force: true });
  });

  it("refuses to restore a second local account for an identity it already has", async () => {
    const harness = await prepare("complete.cyd");
    harness.environment.mainDatabase
      .prepare(
        `INSERT INTO bsky_account (createdAt, updatedAt, handle, did)
         VALUES (1, 1, 'glittertop-old.bsky.social', ?);`,
      )
      .run(ACCOUNT_DID);
    harness.environment.mainDatabase
      .prepare(
        `INSERT INTO account (uuid, sortOrder, type, bskyAccountID)
         VALUES ('existing-uuid', 0, 'bluesky', 1);`,
      )
      .run();

    await expect(
      restoreBlueskyArchiveAccount(harness.environment, {
        archive: {
          intakeId: harness.prepared.intakeId,
          stagingRoot: harness.prepared.stagingRoot,
        },
      }),
    ).rejects.toThrow(/already has a Bluesky account/i);

    expect(
      harness.environment.mainDatabase
        .prepare("SELECT COUNT(*) AS n FROM account;")
        .get(),
    ).toEqual({ n: 1 });

    harness.environment.close();
    fs.rmSync(harness.root, { recursive: true, force: true });
  });
});

describe("a restore that fails part-way", () => {
  it("leaves the installation with no trace of the account it was building", async () => {
    const harness = await prepare("complete.cyd");
    const environment = {
      ...harness.environment,
      openAccountDatabase: async () => {
        throw new Error("the account database could not be opened");
      },
    };

    await expect(
      restoreBlueskyArchiveAccount(environment, {
        archive: {
          intakeId: harness.prepared.intakeId,
          stagingRoot: harness.prepared.stagingRoot,
        },
      }),
    ).rejects.toThrow("the account database could not be opened");

    expect(
      harness.environment.mainDatabase
        .prepare("SELECT COUNT(*) AS n FROM account;")
        .get(),
    ).toEqual({ n: 0 });
    expect(
      fs.existsSync(harness.environment.accountDirectory(ARCHIVE_UUID)),
    ).toBe(false);
    // The prepared archive survives, so retrying costs nothing to unpack again.
    expect(fs.existsSync(harness.prepared.stagingRoot)).toBe(true);

    harness.environment.close();
    fs.rmSync(harness.root, { recursive: true, force: true });
  });
});

function config(database: DatabaseSync, key: string): string | null {
  const row = database
    .prepare("SELECT value FROM config WHERE key = ?;")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { unzipSync } from "fflate";

import {
  applyAccountMigrations,
  blueskyAccountMigrations,
} from "@/database/account-db";
import { createNodeBlueskyArchiveExportEnvironment } from "@/scripts/dev/node-export-environment";
import { runBlueskyArchiveIntake } from "@/services/archive-import";
import { classifyBlueskyArchiveMetadata } from "@/services/archive-metadata";
import {
  createMemoryByteReader,
  createTestBlueskyArchiveIntakeEnvironment,
} from "@/testUtils/archiveFixtures";

import { runBlueskyArchiveExport } from "../export";

/**
 * End-to-end export against a real Bluesky account database.
 *
 * The account is built by running Mobile's own migrations, so this fails if the
 * writer ever drifts from the runtime schema it translates, and the archive is
 * inspected as bytes and SQLite rather than through the writer's own types.
 */

const ACCOUNT_DID = "did:plc:alice";
const ACCOUNT_UUID = "018d5f7a-9b3c-7d10-8a2e-1f4c6b8d0e12";
const OTHER_DID = "did:plc:bob";
const POST_URI = `at://${ACCOUNT_DID}/app.bsky.feed.post/one`;
const LIKED_URI = `at://${OTHER_DID}/app.bsky.feed.post/liked`;
const SAVED_AT = Date.UTC(2026, 8, 1, 12, 0, 0);

type Account = {
  directory: string;
  database: DatabaseSync;
  mediaDirectory: string;
};

function createAccount(root: string): Account {
  const directory = path.join(root, `bluesky-${ACCOUNT_UUID}`);
  const mediaDirectory = path.join(directory, "media");
  fs.mkdirSync(mediaDirectory, { recursive: true });

  const database = new DatabaseSync(path.join(directory, "data.db"));
  applyAccountMigrations(
    {
      getFirstSync: <T,>(sql: string) => database.prepare(sql).get() as T | null,
      execSync: (sql: string) => database.exec(sql),
      withTransactionSync: (run: () => void) => {
        database.exec("BEGIN;");
        try {
          run();
          database.exec("COMMIT;");
        } catch (error) {
          database.exec("ROLLBACK;");
          throw error;
        }
      },
    },
    blueskyAccountMigrations,
  );

  return { directory, database, mediaDirectory };
}

function writeMedia(account: Account, name: string, contents: string): string {
  const location = path.join(account.mediaDirectory, name);
  fs.writeFileSync(location, contents);
  // Devices record an absolute URI that does not exist on this machine, which
  // is exactly what a pulled account directory looks like.
  return `file:///data/user/0/systems.lockdown.cydmobile/files/accounts/bluesky-${ACCOUNT_UUID}/media/${name}`;
}

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function writeMediaBytes(account: Account, name: string, bytes: Uint8Array): string {
  fs.writeFileSync(path.join(account.mediaDirectory, name), bytes);
  return `file:///data/user/0/systems.lockdown.cydmobile/files/accounts/bluesky-${ACCOUNT_UUID}/media/${name}`;
}

function run(database: DatabaseSync, sql: string, params: unknown[] = []): void {
  database.prepare(sql).run(...(params as never[]));
}

function seedAccount(account: Account): void {
  const { database } = account;

  for (const [did, handle] of [
    [ACCOUNT_DID, "alice.example"],
    [OTHER_DID, "bob.example"],
  ]) {
    run(
      database,
      `INSERT INTO profile (did, handle, displayName, avatarUrl, savedAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [did, handle, handle, "https://cdn.example/avatar", SAVED_AT, SAVED_AT],
    );
  }

  run(
    database,
    `INSERT INTO post (uri, cid, authorDid, text, langs, isReply, isQuote, isRepost,
                       likeCount, repostCount, replyCount, quoteCount,
                       viewerLiked, viewerReposted, viewerBookmarked,
                       createdAt, savedAt)
     VALUES (?, ?, ?, ?, 'en', 0, 0, 0, 3, 1, 0, 0, 0, 0, 0, ?, ?);`,
    [POST_URI, "bafypost", ACCOUNT_DID, "A post with pictures", "2026-08-30T09:00:00.000Z", SAVED_AT],
  );
  run(
    database,
    `INSERT INTO post (uri, cid, authorDid, text, isReply, isQuote, isRepost,
                       likeCount, repostCount, replyCount, quoteCount,
                       viewerLiked, likeUri, viewerReposted, viewerBookmarked,
                       createdAt, savedAt)
     VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 1, ?, 0, 1, ?, ?);`,
    [
      LIKED_URI,
      "bafyliked",
      OTHER_DID,
      "Somebody else's post",
      `at://${ACCOUNT_DID}/app.bsky.feed.like/one`,
      "2026-08-20T09:00:00.000Z",
      SAVED_AT,
    ],
  );

  run(
    database,
    `INSERT INTO post_external (postUri, uri, title, description, thumbUrl, thumbLocalPath)
     VALUES (?, 'https://example.com/story', 'A story', 'Something happened',
             'https://cdn.example/thumb.png', ?);`,
    [POST_URI, writeMediaBytes(account, "external-thumb", PNG_HEADER)],
  );

  run(
    database,
    `INSERT INTO bookmark (subjectUri, postAuthorDid, postAuthorHandle, postText,
                           postCreatedAt, savedAt)
     VALUES (?, ?, 'bob.example', ?, '2026-08-20T09:00:00.000Z', ?);`,
    [LIKED_URI, OTHER_DID, "Somebody else's post", SAVED_AT],
  );

  run(
    database,
    `INSERT INTO follow (uri, cid, subjectDid, handle, createdAt, savedAt)
     VALUES (?, 'bafyfollow', ?, 'bob.example', '2026-07-01T09:00:00.000Z', ?);`,
    [`at://${ACCOUNT_DID}/app.bsky.graph.follow/bob`, OTHER_DID, SAVED_AT],
  );

  run(
    database,
    `INSERT INTO conversation (convoId, rev, memberDids, savedAt, updatedAt)
     VALUES ('convo-1', 'rev-1', ?, ?, ?);`,
    [JSON.stringify([ACCOUNT_DID, OTHER_DID]), SAVED_AT, SAVED_AT],
  );
  run(
    database,
    `INSERT INTO message (messageId, convoId, rev, senderDid, text, sentAt, savedAt)
     VALUES ('message-1', 'convo-1', 'rev-1', ?, 'Hello there', '2026-08-31T09:00:00.000Z', ?);`,
    [OTHER_DID, SAVED_AT],
  );

  // Things a Cyd Bluesky archive must never carry.
  run(database, `INSERT INTO config (key, value) VALUES ('session', ?);`, [
    "SUPERSECRETSESSION",
  ]);
  run(
    database,
    `INSERT INTO job (jobType, status, scheduledAt, progressJSON)
     VALUES ('save', 'completed', ?, ?);`,
    [SAVED_AT, '{"note":"SUPERSECRETJOB"}'],
  );
}

function addMedia(
  account: Account,
  options: {
    contentCid: string;
    postUri: string;
    position: number;
    fileName: string;
    contents: string;
    downloadState?: string;
    mediaType?: string;
  },
): void {
  const localPath =
    options.downloadState === "failed"
      ? null
      : writeMedia(account, options.fileName, options.contents);
  run(
    account.database,
    `INSERT INTO media_asset (contentCid, mediaType, mimeType, byteLength, localPath,
                              sourceUrl, sourceDid, downloadState, downloadedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      options.contentCid,
      options.mediaType ?? "image",
      options.mediaType === "video" ? "video/mp4" : "image/jpeg",
      options.contents.length,
      localPath,
      `https://cdn.example/${options.contentCid}`,
      ACCOUNT_DID,
      options.downloadState ?? "complete",
      SAVED_AT,
    ],
  );
  run(
    account.database,
    `INSERT INTO post_media (postUri, position, mediaType, blobCid, mimeType, alt,
                             width, height, assetCid)
     VALUES (?, ?, ?, ?, ?, 'Alt text', 800, 600, ?);`,
    [
      options.postUri,
      options.position,
      options.mediaType ?? "image",
      options.contentCid,
      options.mediaType === "video" ? "video/mp4" : "image/jpeg",
      options.contentCid,
    ],
  );
}

type ExportedArchive = {
  entries: Record<string, Uint8Array>;
  database: DatabaseSync;
  metadata: Record<string, unknown>;
  manifest: { algorithm: string; payloads: { path: string; bytes: number; sha256: string }[] };
  bytes: Uint8Array;
};

function openArchive(location: string, workspace: string): ExportedArchive {
  const bytes = new Uint8Array(fs.readFileSync(location));
  const entries = unzipSync(bytes);
  const extracted = path.join(workspace, "extracted.db");
  fs.writeFileSync(extracted, entries["data.db"]);
  return {
    entries,
    bytes,
    database: new DatabaseSync(extracted, { readOnly: true }),
    metadata: JSON.parse(new TextDecoder().decode(entries["metadata.json"])),
    manifest: JSON.parse(new TextDecoder().decode(entries["manifest.json"])),
  };
}

async function exportAccount(
  account: Account,
  options: { onAccountWorkResumed?: () => void } = {},
) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cyd-export-test-"));
  const environment = createNodeBlueskyArchiveExportEnvironment({
    accountDirectory: account.directory,
    stagingRoot: path.join(workspace, "staging"),
    now: () => new Date("2026-09-10T00:00:00.000Z"),
    onAccountWorkResumed: options.onAccountWorkResumed,
  });

  const result = await runBlueskyArchiveExport(environment, {
    exportId: "export-1",
    accountUuid: ACCOUNT_UUID,
    accountDid: ACCOUNT_DID,
    accountHandle: "alice.example",
    portableSettings: { save_posts: true, save_likes: true, delete_posts: false },
  });

  return { result, archive: openArchive(result.location, workspace), workspace };
}

describe("runBlueskyArchiveExport", () => {
  let root: string;
  let account: Account;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cyd-account-"));
    account = createAccount(root);
    seedAccount(account);
  });

  afterEach(() => {
    account.database.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("packages an account as an archive Cyd's own reader recognizes", async () => {
    addMedia(account, {
      contentCid: "bafyimage",
      postUri: POST_URI,
      position: 0,
      fileName: "bafyimage",
      contents: "image bytes",
    });

    const { result, archive } = await exportAccount(account);

    const media = Object.keys(archive.entries).filter((name) =>
      name.startsWith("media/"),
    );
    expect(Object.keys(archive.entries).sort()).toEqual(
      ["data.db", "manifest.json", "metadata.json", ...media].sort(),
    );
    // The post's image, and the preserved thumbnail of its link preview.
    expect(media).toHaveLength(2);
    for (const name of media) {
      expect(name).toMatch(/^media\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/);
    }
    expect(classifyBlueskyArchiveMetadata(archive.metadata).supported).toBe(true);
    expect(archive.metadata).toMatchObject({
      format: "cyd-archive",
      platform: "bluesky",
      version: 2,
      accountDid: ACCOUNT_DID,
      accountUuid: ACCOUNT_UUID,
      completeness: "complete",
    });
    expect(result.fileName).toBe("cyd-bluesky-alice.example-2026-09-10.cyd");
    expect(result.byteLength).toBe(archive.bytes.length);
  });

  it("produces an archive Cyd's own intake accepts", async () => {
    // The reader is the only judge of the writer that ships in the same app:
    // ZIP framing, the deflated database, the manifest, and the metadata all
    // have to survive a real import's defensive checks.
    addMedia(account, {
      contentCid: "bafyimage",
      postUri: POST_URI,
      position: 0,
      fileName: "bafyimage",
      contents: "image bytes",
    });

    const { archive } = await exportAccount(account);

    const outcome = await runBlueskyArchiveIntake(
      createTestBlueskyArchiveIntakeEnvironment(),
      {
        intakeId: "intake-of-our-own-export",
        sourceUri: "file:///exported.cyd",
        openReader: async () => createMemoryByteReader(archive.bytes),
      },
    );

    expect(outcome).toMatchObject({
      status: "prepared",
      metadata: { accountDid: ACCOUNT_DID, completeness: "complete" },
    });
  });

  it("lists every payload in the manifest with the digest it actually has", async () => {
    addMedia(account, {
      contentCid: "bafyimage",
      postUri: POST_URI,
      position: 0,
      fileName: "bafyimage",
      contents: "image bytes",
    });

    const { archive } = await exportAccount(account);

    const listed = archive.manifest.payloads.map((payload) => payload.path);
    expect(listed).toEqual([...listed].sort());
    expect(listed).toEqual(
      Object.keys(archive.entries)
        .filter((name) => name !== "manifest.json")
        .sort(),
    );
    for (const payload of archive.manifest.payloads) {
      const content = archive.entries[payload.path];
      expect(payload.bytes).toBe(content.length);
      expect(payload.sha256).toBe(
        require("node:crypto").createHash("sha256").update(content).digest("hex"),
      );
    }
  });

  it("builds an interchange database, not a copy of Mobile's own", async () => {
    const { archive } = await exportAccount(account);

    const tables = archive.database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual([
      "archive",
      "assets",
      "conversation_members",
      "conversations",
      "identity",
      "messages",
      "portable_settings",
      "profiles",
      "record_assets",
      "record_context",
      "record_subjects",
      "records",
      "relationships",
      "selections",
    ]);
    expect(
      archive.database.prepare("PRAGMA application_id;").get(),
    ).toEqual({ application_id: 0x43594232 });
    expect(archive.database.prepare("PRAGMA user_version;").get()).toEqual({
      user_version: 2,
    });
    expect(archive.database.prepare("PRAGMA foreign_key_check;").all()).toEqual([]);
    expect(archive.database.prepare("PRAGMA integrity_check;").get()).toEqual({
      integrity_check: "ok",
    });
  });

  it("carries the account's records, context, chats, follows, and settings", async () => {
    const { archive } = await exportAccount(account);
    const all = (sql: string) => archive.database.prepare(sql).all();

    expect(all("SELECT category, subject_id FROM selections ORDER BY category")).toEqual([
      { category: "bookmarks", subject_id: LIKED_URI },
      { category: "chats", subject_id: "convo-1" },
      {
        category: "likes",
        subject_id: `at://${ACCOUNT_DID}/app.bsky.feed.like/one`,
      },
      { category: "posts", subject_id: POST_URI },
    ]);
    expect(all("SELECT kind FROM record_context")).toEqual([{ kind: "external" }]);
    expect(all("SELECT COUNT(*) AS total FROM messages")).toEqual([{ total: 1 }]);
    expect(all("SELECT kind, subject_did FROM relationships")).toEqual([
      { kind: "follow", subject_did: OTHER_DID },
    ]);
    expect(all("SELECT key, value_json FROM portable_settings ORDER BY key")).toEqual([
      { key: "delete_posts", value_json: "false" },
      { key: "save_likes", value_json: "true" },
      { key: "save_posts", value_json: "true" },
    ]);
  });

  it("carries no credentials, jobs, or local file paths", async () => {
    addMedia(account, {
      contentCid: "bafyimage",
      postUri: POST_URI,
      position: 0,
      fileName: "bafyimage",
      contents: "image bytes",
    });
    // An asset that vanishes forces the export down the path where a storage
    // error's own message — which names a device path — could reach the
    // archive as an unavailable_reason.
    addMedia(account, {
      contentCid: "bafygone",
      postUri: POST_URI,
      position: 1,
      fileName: "bafygone",
      contents: "doomed bytes",
    });

    const { archive } = await exportAccount(account, {
      onAccountWorkResumed: () =>
        fs.rmSync(path.join(account.mediaDirectory, "bafygone")),
    });
    const text = new TextDecoder().decode(archive.entries["data.db"]);

    expect(text).not.toContain("SUPERSECRETSESSION");
    expect(text).not.toContain("SUPERSECRETJOB");
    expect(text).not.toContain("/private/thumb.jpg");
    expect(text).not.toContain("file:///data/user/0");
    expect(text).not.toContain(account.mediaDirectory);
    expect(text).not.toContain("ENOENT");
    expect(text).not.toContain(os.tmpdir());
  });

  it("describes one point in time even when saving resumes underneath it", async () => {
    addMedia(account, {
      contentCid: "bafykept",
      postUri: POST_URI,
      position: 0,
      fileName: "bafykept",
      contents: "kept image bytes",
    });
    addMedia(account, {
      contentCid: "bafylost",
      postUri: POST_URI,
      position: 1,
      fileName: "bafylost",
      contents: "lost image bytes",
    });

    const { archive } = await exportAccount(account, {
      onAccountWorkResumed: () => {
        run(
          account.database,
          `INSERT INTO post (uri, cid, authorDid, text, isReply, isQuote, isRepost,
                             likeCount, repostCount, replyCount, quoteCount,
                             viewerLiked, viewerReposted, viewerBookmarked,
                             createdAt, savedAt)
           VALUES (?, 'bafylater', ?, 'Saved after the snapshot', 0, 0, 0,
                   0, 0, 0, 0, 0, 0, 0, '2026-09-09T09:00:00.000Z', ?);`,
          [`at://${ACCOUNT_DID}/app.bsky.feed.post/later`, ACCOUNT_DID, Date.now()],
        );
        fs.rmSync(path.join(account.mediaDirectory, "bafylost"));
      },
    });

    const records = archive.database
      .prepare("SELECT uri FROM records ORDER BY uri")
      .all()
      .map((row) => (row as { uri: string }).uri);
    expect(records).not.toContain(`at://${ACCOUNT_DID}/app.bsky.feed.post/later`);

    const assets = archive.database
      .prepare("SELECT id, availability, unavailable_reason FROM assets ORDER BY id")
      .all() as { id: string; availability: string; unavailable_reason: string | null }[];
    expect(assets).toEqual([
      expect.objectContaining({ id: "bafykept", availability: "available" }),
      expect.objectContaining({
        id: "bafylost",
        availability: "unavailable",
        unavailable_reason:
          "The preserved file could not be read while the export was being packaged.",
      }),
      expect.objectContaining({
        id: expect.stringContaining("preview:"),
        availability: "available",
      }),
    ]);
    expect(archive.metadata.completeness).toBe("incomplete");
    // A storage error names the path it failed on. That must not ride along
    // into the archive as an explanation.
    expect(assets[1].unavailable_reason).not.toMatch(/bafylost|ENOENT|\//);
  });

  it("exports the rest of an account whose media never finished downloading", async () => {
    addMedia(account, {
      contentCid: "bafyvideo",
      postUri: POST_URI,
      position: 0,
      fileName: "bafyvideo",
      contents: "",
      downloadState: "failed",
      mediaType: "video",
    });

    const { result, archive } = await exportAccount(account);

    expect(archive.metadata.completeness).toBe("incomplete");
    expect(result.assets).toEqual({
      total: 2,
      available: 1,
      missing: 1,
      unavailable: 0,
    });
    expect(
      archive.database.prepare("SELECT COUNT(*) AS total FROM records").get(),
    ).toEqual({ total: 3 });
    expect(
      archive.database.prepare("SELECT COUNT(*) AS total FROM record_assets").get(),
    ).toEqual({ total: 2 });
    // Only the preview: the video Cyd never finished downloading has no bytes.
    expect(
      Object.keys(archive.entries).filter((name) => name.startsWith("media/")),
    ).toHaveLength(1);
  });

  it("packages an asset two records share exactly once", async () => {
    addMedia(account, {
      contentCid: "bafyshared",
      postUri: POST_URI,
      position: 0,
      fileName: "bafyshared",
      contents: "shared image bytes",
    });
    run(
      account.database,
      `INSERT INTO post_media (postUri, position, mediaType, blobCid, mimeType,
                               width, height, assetCid)
       VALUES (?, 0, 'image', 'bafyshared', 'image/jpeg', 800, 600, 'bafyshared');`,
      [LIKED_URI],
    );

    const { archive } = await exportAccount(account);

    expect(
      archive.database
        .prepare("SELECT COUNT(*) AS total FROM assets WHERE kind = 'image'")
        .get(),
    ).toEqual({ total: 1 });
    expect(
      archive.database
        .prepare(
          "SELECT COUNT(*) AS total FROM record_assets WHERE role = 'content'",
        )
        .get(),
    ).toEqual({ total: 2 });
    expect(
      Object.keys(archive.entries).filter((name) => name.startsWith("media/")),
    ).toHaveLength(2);
  });
});

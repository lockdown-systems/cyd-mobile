import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createNodeBlueskyArchiveExportEnvironment } from "@/scripts/dev/node-export-environment";
import { runBlueskyArchiveIntake } from "@/services/archive-import";
import { classifyBlueskyArchiveMetadata } from "@/services/archive-metadata";
import {
  createMemoryByteReader,
  createTestBlueskyArchiveIntakeEnvironment,
} from "@/testUtils/archiveFixtures";
import {
  ACCOUNT_DID,
  ACCOUNT_UUID,
  LIKED_URI,
  OTHER_DID,
  POST_URI,
  addMedia,
  createAccount,
  openArchive,
  run,
  seedAccount,
  type Account,
} from "@/testUtils/blueskyExportAccount";

import { runBlueskyArchiveExport } from "../export";

/**
 * End-to-end export against a real Bluesky account database.
 *
 * The account is built by running Mobile's own migrations, so this fails if the
 * writer ever drifts from the runtime schema it translates, and the archive is
 * inspected as bytes and SQLite rather than through the writer's own types.
 */

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

  it("packages the archive's own entries and nothing else from staging", async () => {
    addMedia(account, {
      contentCid: "bafyimage",
      postUri: POST_URI,
      position: 0,
      fileName: "bafyimage",
      contents: "image bytes",
    });

    const { archive } = await exportAccount(account);

    // Staging holds a copy of the account database and the export's own
    // checkpoint alongside the archive being built. Both are working state:
    // one is Mobile's private schema, the other names this installation's
    // files. Neither is a thing a Cyd Bluesky archive can contain, and the
    // manifest must not claim otherwise either.
    const entries = Object.keys(archive.entries).sort();
    expect(entries).toEqual([
      "data.db",
      "manifest.json",
      // sha256 of the link preview's PNG header, and of the image's own bytes.
      "media/sha256/4c/4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6",
      "media/sha256/de/de7030234493a8bea844dbe1d8676e68a2c1a4b014c721f0425a22b6df66faec",
      "metadata.json",
    ]);
    expect(archive.manifest.payloads.map((payload) => payload.path).sort()).toEqual(
      entries.filter((name) => name !== "manifest.json"),
    );
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

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { unzipSync } from "fflate";

import {
  applyAccountMigrations,
  blueskyAccountMigrations,
} from "@/database/account-db";

/**
 * A seeded Bluesky local account on disk, and the archive an export makes of it.
 *
 * This is what a pulled account directory looks like: `data.db` carrying
 * Mobile's own account migrations, and preserved media beside it. Tests that
 * exercise the Cyd Bluesky archive writer share it so that the account they
 * export and the account the app would export are the same account.
 */

export const ACCOUNT_DID = "did:plc:alice";
export const ACCOUNT_UUID = "018d5f7a-9b3c-7d10-8a2e-1f4c6b8d0e12";
export const OTHER_DID = "did:plc:bob";
export const POST_URI = `at://${ACCOUNT_DID}/app.bsky.feed.post/one`;
export const LIKED_URI = `at://${OTHER_DID}/app.bsky.feed.post/liked`;
export const SAVED_AT = Date.UTC(2026, 8, 1, 12, 0, 0);

export type Account = {
  directory: string;
  database: DatabaseSync;
  mediaDirectory: string;
};

export function createAccount(root: string): Account {
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

export function writeMedia(account: Account, name: string, contents: string): string {
  const location = path.join(account.mediaDirectory, name);
  fs.writeFileSync(location, contents);
  // Devices record an absolute URI that does not exist on this machine, which
  // is exactly what a pulled account directory looks like.
  return `file:///data/user/0/systems.lockdown.cydmobile/files/accounts/bluesky-${ACCOUNT_UUID}/media/${name}`;
}

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function writeMediaBytes(account: Account, name: string, bytes: Uint8Array): string {
  fs.writeFileSync(path.join(account.mediaDirectory, name), bytes);
  return `file:///data/user/0/systems.lockdown.cydmobile/files/accounts/bluesky-${ACCOUNT_UUID}/media/${name}`;
}

export function run(database: DatabaseSync, sql: string, params: unknown[] = []): void {
  database.prepare(sql).run(...(params as never[]));
}

export function seedAccount(account: Account): void {
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

export function addMedia(
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

export type ExportedArchive = {
  entries: Record<string, Uint8Array>;
  database: DatabaseSync;
  metadata: Record<string, unknown>;
  manifest: { algorithm: string; payloads: { path: string; bytes: number; sha256: string }[] };
  bytes: Uint8Array;
};

export function openArchive(location: string, workspace: string): ExportedArchive {
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

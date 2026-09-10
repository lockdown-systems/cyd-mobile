import { previewAssetKey } from "./assets";
import type { ReadableDatabase } from "./ports";

/**
 * Reading Cyd Mobile's private per-account storage, and nothing else.
 *
 * This is one half of the version 2 adapter ADR 0002 calls for: the only place
 * that knows Mobile's runtime column names. Everything downstream works on
 * these row types, so a Mobile migration lands here and stops here instead of
 * reaching the interchange model.
 *
 * The queries are also the privacy boundary in practice. `config`, `job`, and
 * the local-only columns (`localPath`, `thumbLocalPath`, `preserve`) are not
 * selected at all, so no later step can leak what it never received.
 */

export type MobileProfileRow = {
  did: string;
  handle: string;
  displayName: string | null;
  savedAt: number;
  updatedAt: number;
};

export type MobilePostRow = {
  uri: string;
  cid: string;
  authorDid: string;
  text: string;
  facetsJSON: string | null;
  embedJSON: string | null;
  langs: string | null;
  isReply: number;
  replyParentUri: string | null;
  replyRootUri: string | null;
  isQuote: number;
  quotedPostUri: string | null;
  isRepost: number;
  repostUri: string | null;
  repostCid: string | null;
  originalPostUri: string | null;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  viewerLiked: number;
  viewerReposted: number;
  viewerBookmarked: number;
  createdAt: string;
  savedAt: number;
  deletedPostAt: number | null;
  deletedRepostAt: number | null;
  deletedLikeAt: number | null;
  deletedBookmarkAt: number | null;
  likeUri: string | null;
};

export type MobilePostMediaRow = {
  postUri: string;
  position: number;
  mediaType: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  assetCid: string | null;
};

export type MobilePostExternalRow = {
  postUri: string;
  uri: string;
  title: string;
  description: string | null;
  thumbUrl: string | null;
};

export type MobileBookmarkRow = {
  subjectUri: string;
  postAuthorDid: string | null;
  postAuthorHandle: string | null;
  postText: string | null;
  postCreatedAt: string | null;
  savedAt: number;
  deletedAt: number | null;
};

export type MobileFollowRow = {
  uri: string;
  subjectDid: string;
  handle: string;
  createdAt: string;
  savedAt: number;
  unfollowedAt: number | null;
};

export type MobileConversationRow = {
  convoId: string;
  rev: string | null;
  memberDids: string;
  savedAt: number;
  updatedAt: number;
  leftAt: number | null;
};

export type MobileMessageRow = {
  messageId: string;
  convoId: string;
  rev: string | null;
  senderDid: string;
  text: string;
  facetsJSON: string | null;
  embedJSON: string | null;
  sentAt: string;
  savedAt: number;
  deletedAt: number | null;
};

export type MobileMediaAssetRow = {
  contentCid: string;
  mediaType: string;
  mimeType: string | null;
  sourceUrl: string | null;
  sourceMetadataJSON: string | null;
  downloadState: string;
  lastError: string | null;
};

/**
 * Where a preserved asset's bytes are, which only the staging step may know.
 *
 * Deliberately not part of {@link MobileAccountSnapshot}: `localPath` is a
 * device filesystem path, and the contract's privacy boundary keeps those out
 * of a Cyd Bluesky archive. Translation never receives one. Neither is
 * `media_asset.lastError` read anywhere — a stored download error is an error
 * report, which the same boundary excludes.
 */
export type MobileInventoryRow = {
  key: string;
  localPath: string | null;
  preserved: boolean;
};

export type MobileAccountSnapshot = {
  profiles: MobileProfileRow[];
  posts: MobilePostRow[];
  postMedia: MobilePostMediaRow[];
  postExternals: MobilePostExternalRow[];
  bookmarks: MobileBookmarkRow[];
  follows: MobileFollowRow[];
  conversations: MobileConversationRow[];
  messages: MobileMessageRow[];
  mediaAssets: MobileMediaAssetRow[];
};

/**
 * Read everything an export needs out of one staged snapshot.
 *
 * Ordering is by stable identifier throughout, so two exports of unchanged
 * data produce the same Bluesky interchange database rather than the same data
 * in a
 * different order.
 */
export function readMobileAccountSnapshot(
  database: ReadableDatabase,
): MobileAccountSnapshot {
  return {
    profiles: database.all<MobileProfileRow>(
      `SELECT did, handle, displayName, savedAt, updatedAt
       FROM profile ORDER BY did;`,
    ),
    posts: database.all<MobilePostRow>(
      `SELECT uri, cid, authorDid, text, facetsJSON, embedJSON, langs,
              isReply, replyParentUri, replyRootUri,
              isQuote, quotedPostUri,
              isRepost, repostUri, repostCid, originalPostUri,
              likeCount, repostCount, replyCount, quoteCount,
              viewerLiked, viewerReposted, viewerBookmarked,
              createdAt, savedAt,
              deletedPostAt, deletedRepostAt, deletedLikeAt, deletedBookmarkAt,
              likeUri
       FROM post ORDER BY uri;`,
    ),
    postMedia: database.all<MobilePostMediaRow>(
      `SELECT postUri, position, mediaType, alt, width, height, assetCid
       FROM post_media ORDER BY postUri, position;`,
    ),
    postExternals: database.all<MobilePostExternalRow>(
      `SELECT postUri, uri, title, description, thumbUrl
       FROM post_external ORDER BY postUri;`,
    ),
    bookmarks: database.all<MobileBookmarkRow>(
      `SELECT subjectUri, postAuthorDid, postAuthorHandle, postText,
              postCreatedAt, savedAt, deletedAt
       FROM bookmark ORDER BY subjectUri;`,
    ),
    follows: database.all<MobileFollowRow>(
      `SELECT uri, subjectDid, handle, createdAt, savedAt, unfollowedAt
       FROM follow ORDER BY uri;`,
    ),
    conversations: database.all<MobileConversationRow>(
      `SELECT convoId, rev, memberDids, savedAt, updatedAt, leftAt
       FROM conversation ORDER BY convoId;`,
    ),
    messages: database.all<MobileMessageRow>(
      `SELECT messageId, convoId, rev, senderDid, text, facetsJSON, embedJSON,
              sentAt, savedAt, deletedAt
       FROM message ORDER BY messageId;`,
    ),
    mediaAssets: database.all<MobileMediaAssetRow>(
      `SELECT contentCid, mediaType, mimeType, sourceUrl,
              sourceMetadataJSON, downloadState, lastError
       FROM media_asset ORDER BY contentCid;`,
    ),
  };
}

/**
 * List where each preserved asset's bytes live, for the staging step alone.
 *
 * Taken from the same staged snapshot as everything else, so the inventory and
 * the database agree on one point in time even if saving resumes immediately
 * afterwards (ADR 0010).
 *
 * Two kinds of file are preserved on this device. Record media is
 * content-addressed in `media_asset` and tracks its own download state. A link
 * preview's thumbnail is not: `post_external` either has the file or it does
 * not, so having a path is the whole of "preserved" for one.
 */
export function readAssetInventory(database: ReadableDatabase): MobileInventoryRow[] {
  const media = database
    .all<{ contentCid: string; localPath: string | null; downloadState: string }>(
      `SELECT contentCid, localPath, downloadState
       FROM media_asset ORDER BY contentCid;`,
    )
    .map((row) => ({
      key: row.contentCid,
      localPath: row.localPath,
      preserved: row.downloadState === "complete",
    }));

  const previews = database
    .all<{ postUri: string; thumbLocalPath: string }>(
      `SELECT postUri, thumbLocalPath
       FROM post_external
       WHERE thumbLocalPath IS NOT NULL
       ORDER BY postUri;`,
    )
    .map((row) => ({
      key: previewAssetKey(row.postUri),
      localPath: row.thumbLocalPath,
      preserved: true,
    }));

  return [...media, ...previews];
}

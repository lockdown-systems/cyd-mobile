import type { MergeableAccountDatabase } from "./ports";
import type {
  ExistingAccountRows,
  ExistingMediaAssetRow,
  ExistingPostRow,
  MobileBookmarkWrite,
  MobileConversationWrite,
  MobileFollowWrite,
  MobileMessageWrite,
  MobilePostExternalWrite,
  MobilePostMediaWrite,
  MobileProfileWrite,
} from "./rows";

/**
 * Reading a Bluesky local account back out in the shape a restore writes it.
 *
 * This is the mirror of `services/archive-restore/account-writer.ts`, and it
 * exists so the merge compares like with like: the archive's side arrives as
 * Mobile rows through the translation, and this turns the account's own side
 * into the same rows. Columns Mobile fills in for itself — a row id, the
 * denormalized aspect ratio — are left out, because nothing in a union has an
 * opinion about them.
 *
 * `viewer*` columns are nullable in Mobile's schema and are read as flags
 * here. A null and a zero mean the same thing to browse, and normalizing them
 * is what keeps a second import of the same archive from writing rows back
 * unchanged.
 */

const flag = (value: number | null): number => (value === 1 ? 1 : 0);

export async function readExistingAccountRows(
  database: MergeableAccountDatabase,
): Promise<ExistingAccountRows> {
  const posts = await database.all<ExistingPostRow>(
    `SELECT uri, cid, authorDid, text, facetsJSON, embedType, embedJSON, langs,
            isReply, replyParentUri, replyRootUri, isQuote, quotedPostUri,
            isRepost, repostUri, repostCid, originalPostUri,
            likeCount, repostCount, replyCount, quoteCount,
            viewerLiked, likeUri, viewerReposted, viewerBookmarked,
            createdAt, savedAt,
            deletedPostAt, deletedRepostAt, deletedLikeAt, deletedBookmarkAt,
            preserve
     FROM post ORDER BY uri;`,
  );

  return {
    profiles: await database.all<MobileProfileWrite>(
      `SELECT did, handle, displayName, avatarUrl, savedAt, updatedAt
       FROM profile ORDER BY did;`,
    ),
    posts: posts.map((post) => ({
      ...post,
      isReply: flag(post.isReply),
      isQuote: flag(post.isQuote),
      isRepost: flag(post.isRepost),
      viewerLiked: flag(post.viewerLiked),
      viewerReposted: flag(post.viewerReposted),
      viewerBookmarked: flag(post.viewerBookmarked),
      preserve: flag(post.preserve),
    })),
    postMedia: await database.all<MobilePostMediaWrite>(
      `SELECT postUri, position, mediaType, blobCid, mimeType, alt,
              width, height, thumbUrl, fullsizeUrl, playlistUrl,
              downloadedAt, assetCid
       FROM post_media ORDER BY postUri, position;`,
    ),
    postExternals: await database.all<MobilePostExternalWrite>(
      `SELECT postUri, uri, title, description, thumbUrl, thumbLocalPath
       FROM post_external ORDER BY postUri;`,
    ),
    bookmarks: await database.all<MobileBookmarkWrite>(
      `SELECT subjectUri, postAuthorDid, postAuthorHandle, postText,
              postCreatedAt, savedAt, deletedAt
       FROM bookmark ORDER BY subjectUri;`,
    ),
    follows: await database.all<MobileFollowWrite>(
      `SELECT uri, cid, subjectDid, handle, displayName, avatarUrl,
              createdAt, savedAt, unfollowedAt
       FROM follow ORDER BY uri;`,
    ),
    conversations: await database.all<MobileConversationWrite>(
      `SELECT convoId, rev, memberDids, muted, lastMessageId, lastMessageText,
              lastMessageSentAt, lastMessageSenderDid, savedAt, updatedAt, leftAt
       FROM conversation ORDER BY convoId;`,
    ),
    messages: await database.all<MobileMessageWrite>(
      `SELECT messageId, convoId, rev, senderDid, text, facetsJSON, embedJSON,
              sentAt, savedAt, deletedAt
       FROM message ORDER BY messageId;`,
    ),
    mediaAssets: await database.all<ExistingMediaAssetRow>(
      `SELECT contentCid, mediaType, mimeType, byteLength, localPath, sourceUrl,
              sourceDid, sourceMetadataJSON, downloadState, lastError,
              attemptCount, downloadedAt
       FROM media_asset ORDER BY contentCid;`,
    ),
  };
}

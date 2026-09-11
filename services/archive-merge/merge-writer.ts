import type { BlueskyArchiveMergePlan } from "./merge-plan";
import type { MergeableAccountDatabase } from "./ports";

/**
 * Writing a merged plan into a Bluesky local account.
 *
 * Almost the same statements as a restore's, with one difference that matters:
 * `INSERT OR REPLACE` deletes the stored row and inserts a new one, so every
 * column a live account fills in for itself has to be named here or a merge
 * would quietly clear it. Those columns — a preserved post, a downloader's
 * attempt count — come off the merged row, where the union rules already
 * carried the local value across.
 *
 * The order is the restore's order, for the same reason: Mobile's schema has
 * foreign keys on, so profiles precede the records that name them, media
 * assets precede the attachments that reference them, and conversations
 * precede their messages.
 */
export async function writeMergedAccountRows(
  database: MergeableAccountDatabase,
  plan: BlueskyArchiveMergePlan,
): Promise<void> {
  for (const profile of plan.profiles) {
    await database.run(
      `INSERT OR REPLACE INTO profile (did, handle, displayName, avatarUrl, savedAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [
        profile.did,
        profile.handle,
        profile.displayName,
        profile.avatarUrl,
        profile.savedAt,
        profile.updatedAt,
      ],
    );
  }

  for (const post of plan.posts) {
    await database.run(
      `INSERT OR REPLACE INTO post (
        uri, cid, authorDid,
        text, facetsJSON, embedType, embedJSON, langs,
        isReply, replyParentUri, replyRootUri,
        isQuote, quotedPostUri,
        isRepost, repostUri, repostCid, originalPostUri,
        likeCount, repostCount, replyCount, quoteCount,
        viewerLiked, likeUri, viewerReposted, viewerBookmarked,
        createdAt, savedAt,
        deletedPostAt, deletedRepostAt, deletedLikeAt, deletedBookmarkAt,
        preserve
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        post.uri,
        post.cid,
        post.authorDid,
        post.text,
        post.facetsJSON,
        post.embedType,
        post.embedJSON,
        post.langs,
        post.isReply,
        post.replyParentUri,
        post.replyRootUri,
        post.isQuote,
        post.quotedPostUri,
        post.isRepost,
        post.repostUri,
        post.repostCid,
        post.originalPostUri,
        post.likeCount,
        post.repostCount,
        post.replyCount,
        post.quoteCount,
        post.viewerLiked,
        post.likeUri,
        post.viewerReposted,
        post.viewerBookmarked,
        post.createdAt,
        post.savedAt,
        post.deletedPostAt,
        post.deletedRepostAt,
        post.deletedLikeAt,
        post.deletedBookmarkAt,
        post.preserve,
      ],
    );
  }

  for (const asset of plan.mediaAssets) {
    await database.run(
      `INSERT OR REPLACE INTO media_asset (
        contentCid, mediaType, mimeType, byteLength, localPath, sourceUrl,
        sourceDid, sourceMetadataJSON, downloadState, lastError, attemptCount,
        downloadedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        asset.contentCid,
        asset.mediaType,
        asset.mimeType,
        asset.byteLength,
        asset.localPath,
        asset.sourceUrl,
        asset.sourceDid,
        asset.sourceMetadataJSON,
        asset.downloadState,
        asset.lastError,
        asset.attemptCount,
        asset.downloadedAt,
      ],
    );
  }

  for (const media of plan.postMedia) {
    await database.run(
      `INSERT OR REPLACE INTO post_media (
        postUri, position, mediaType, blobCid, mimeType, alt,
        width, height, aspectRatioWidth, aspectRatioHeight,
        thumbUrl, fullsizeUrl, playlistUrl, downloadedAt, assetCid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        media.postUri,
        media.position,
        media.mediaType,
        media.blobCid,
        media.mimeType,
        media.alt,
        media.width,
        media.height,
        media.width,
        media.height,
        media.thumbUrl,
        media.fullsizeUrl,
        media.playlistUrl,
        media.downloadedAt,
        media.assetCid,
      ],
    );
  }

  for (const external of plan.postExternals) {
    await database.run(
      `INSERT OR REPLACE INTO post_external (
        postUri, uri, title, description, thumbUrl, thumbLocalPath
      ) VALUES (?, ?, ?, ?, ?, ?);`,
      [
        external.postUri,
        external.uri,
        external.title,
        external.description,
        external.thumbUrl,
        external.thumbLocalPath,
      ],
    );
  }

  for (const bookmark of plan.bookmarks) {
    await database.run(
      `INSERT OR REPLACE INTO bookmark (
        subjectUri, postAuthorDid, postAuthorHandle, postText, postCreatedAt,
        savedAt, deletedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [
        bookmark.subjectUri,
        bookmark.postAuthorDid,
        bookmark.postAuthorHandle,
        bookmark.postText,
        bookmark.postCreatedAt,
        bookmark.savedAt,
        bookmark.deletedAt,
      ],
    );
  }

  for (const follow of plan.follows) {
    await database.run(
      `INSERT OR REPLACE INTO follow (
        uri, cid, subjectDid, handle, displayName, avatarUrl,
        createdAt, savedAt, unfollowedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        follow.uri,
        follow.cid,
        follow.subjectDid,
        follow.handle,
        follow.displayName,
        follow.avatarUrl,
        follow.createdAt,
        follow.savedAt,
        follow.unfollowedAt,
      ],
    );
  }

  for (const conversation of plan.conversations) {
    await database.run(
      `INSERT OR REPLACE INTO conversation (
        convoId, rev, memberDids, muted,
        lastMessageId, lastMessageText, lastMessageSentAt, lastMessageSenderDid,
        savedAt, updatedAt, leftAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        conversation.convoId,
        conversation.rev,
        conversation.memberDids,
        conversation.muted,
        conversation.lastMessageId,
        conversation.lastMessageText,
        conversation.lastMessageSentAt,
        conversation.lastMessageSenderDid,
        conversation.savedAt,
        conversation.updatedAt,
        conversation.leftAt,
      ],
    );
  }

  for (const message of plan.messages) {
    await database.run(
      `INSERT OR REPLACE INTO message (
        messageId, convoId, rev, senderDid, text, facetsJSON, embedJSON,
        sentAt, savedAt, deletedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        message.messageId,
        message.convoId,
        message.rev,
        message.senderDid,
        message.text,
        message.facetsJSON,
        message.embedJSON,
        message.sentAt,
        message.savedAt,
        message.deletedAt,
      ],
    );
  }
}

/** How many rows a plan would write, which is what "no effect" means. */
export function countPlannedWrites(plan: BlueskyArchiveMergePlan): number {
  return (
    plan.profiles.length +
    plan.posts.length +
    plan.postMedia.length +
    plan.postExternals.length +
    plan.bookmarks.length +
    plan.follows.length +
    plan.conversations.length +
    plan.messages.length +
    plan.mediaAssets.length
  );
}

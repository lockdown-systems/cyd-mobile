import type { RestoredMobileAccount } from "./mobile-rows";
import type { RestoredAccountDatabase } from "./ports";

/**
 * Writing translated rows into a Bluesky local account's private database.
 *
 * The only thing this file decides is order. Mobile's schema has foreign keys
 * on, so profiles come before the records that name them, media assets before
 * the attachments that reference them, and conversations before their
 * messages. Everything else was settled in the translation.
 *
 * The statements are `INSERT OR REPLACE` rather than plain inserts so that a
 * restore is safe to run again over a database it already filled — a merge
 * into an account that already holds data is #97's problem, but a retry of
 * this one must not fail halfway on a row it wrote the first time.
 */
export async function writeRestoredAccountRows(
  database: RestoredAccountDatabase,
  restored: RestoredMobileAccount,
): Promise<void> {
  for (const profile of restored.profiles) {
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

  for (const post of restored.posts) {
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
        deletedPostAt, deletedRepostAt, deletedLikeAt, deletedBookmarkAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
      ],
    );
  }

  for (const asset of restored.mediaAssets) {
    await database.run(
      `INSERT OR REPLACE INTO media_asset (
        contentCid, mediaType, mimeType, byteLength, localPath, sourceUrl,
        sourceDid, sourceMetadataJSON, downloadState, lastError, attemptCount,
        downloadedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?);`,
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
        asset.downloadedAt,
      ],
    );
  }

  for (const media of restored.postMedia) {
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

  for (const external of restored.postExternals) {
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

  for (const bookmark of restored.bookmarks) {
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

  for (const follow of restored.follows) {
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

  for (const conversation of restored.conversations) {
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

  for (const message of restored.messages) {
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

/**
 * @fileoverview Functions for calculating what data will be deleted
 * based on the user's delete settings.
 */

import type { AccountDeleteSettings } from "@/database/delete-settings";
import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Result of calculating what data will be deleted
 */
export interface DeletionPreview {
  postsToDelete: PostToDelete[];
  repostsToDelete: RepostToDelete[];
  likesToDelete: LikeToDelete[];
  messagesToDelete: MessageToDelete[];
  bookmarksToDelete: BookmarkToDelete[];
  followsToUnfollow: FollowToUnfollow[];
}

/**
 * Summary counts of items to be deleted
 */
export interface DeletionPreviewCounts {
  posts: number;
  reposts: number;
  likes: number;
  messages: number;
  bookmarks: number;
  follows: number;
}

export interface PostToDelete {
  uri: string;
  cid: string;
  text: string;
  createdAt: string;
  likeCount: number;
  repostCount: number;
  replyRootUri: string | null;
}

export interface RepostToDelete {
  uri: string;
  repostUri: string;
  repostCid: string;
  createdAt: string;
  originalPostUri: string;
}

export interface LikeToDelete {
  uri: string;
  likeUri: string | null;
  createdAt: string;
  text: string;
  authorHandle: string;
}

export interface MessageToDelete {
  messageId: string;
  convoId: string;
  text: string;
  sentAt: string;
}

export interface BookmarkToDelete {
  id: number;
  subjectUri: string;
  postText: string | null;
}

export interface FollowToUnfollow {
  uri: string;
  cid: string;
  subjectDid: string;
  handle: string;
  displayName: string | null;
}

/**
 * Extended post data for preview in the deletion review UI.
 * Includes author info and additional fields needed for PostPreview component.
 */
export interface PostToDeletePreview {
  uri: string;
  cid: string;
  text: string;
  createdAt: string;
  savedAt: number;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  isReply: boolean;
  preserve: boolean;
  authorDid: string;
  authorHandle: string | null;
  authorDisplayName: string | null;
  avatarUrl: string | null;
  avatarDataURI: string | null;
  embedJSON: string | null;
  quotedPostUri: string | null;
  facetsJSON: string | null;
}

/**
 * Get the ISO timestamp for N days ago from now
 */
export function getTimestampDaysAgo(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() - days);
  return now.toISOString();
}

/**
 * Calculate what posts will be deleted based on the settings.
 *
 * The logic:
 * 1. Select posts that are not reposts, not already deleted
 * 2. Apply days-old filter if enabled
 * 3. Apply likes/reposts threshold filters if enabled
 * 4. If preserveThreads is enabled, exclude posts in threads where any post
 *    meets the threshold criteria
 */
export function calculatePostsToDelete(
  db: SQLiteDatabase,
  userDid: string,
  settings: AccountDeleteSettings
): PostToDelete[] {
  if (!settings.deletePosts) {
    return [];
  }

  // Calculate the timestamp cutoff if days-old filter is enabled
  const daysOldTimestamp = settings.deletePostsDaysOldEnabled
    ? getTimestampDaysAgo(settings.deletePostsDaysOld)
    : null;

  // Build the WHERE clause dynamically
  let whereClause = `
    isRepost = 0
    AND deletedPostAt IS NULL
    AND preserve = 0
    AND authorDid = ?
  `;
  const params: (string | number)[] = [userDid];

  if (daysOldTimestamp) {
    whereClause += " AND createdAt <= ?";
    params.push(daysOldTimestamp);
  }

  if (settings.deletePostsLikesThresholdEnabled) {
    whereClause += " AND likeCount < ?";
    params.push(settings.deletePostsLikesThreshold);
  }

  if (settings.deletePostsRepostsThresholdEnabled) {
    whereClause += " AND repostCount < ?";
    params.push(settings.deletePostsRepostsThreshold);
  }

  // First, get all candidate posts to delete
  const candidatePosts = db.getAllSync<{
    uri: string;
    cid: string;
    text: string;
    createdAt: string;
    likeCount: number;
    repostCount: number;
    replyRootUri: string | null;
  }>(
    `SELECT uri, cid, text, createdAt, likeCount, repostCount, replyRootUri
     FROM post
     WHERE ${whereClause}
     ORDER BY createdAt ASC;`,
    params
  );

  if (!settings.deletePostsPreserveThreads) {
    // No thread preservation, return all candidates
    return candidatePosts;
  }

  // Thread preservation logic:
  // We need to find all thread roots that have at least one post meeting the threshold
  // and exclude ALL posts in those threads from deletion.

  // A post's thread root is:
  // - replyRootUri if it's a reply (replyRootUri is not null)
  // - its own uri if it's not a reply (replyRootUri is null)

  // First, find all thread roots that should be preserved
  // A thread should be preserved if ANY post in it meets the threshold criteria
  const preservedThreadRoots = findPreservedThreadRoots(db, userDid, settings);

  // Filter out posts whose thread root is in the preserved set
  return candidatePosts.filter((post) => {
    const threadRoot = post.replyRootUri ?? post.uri;
    return !preservedThreadRoots.has(threadRoot);
  });
}

/**
 * Calculate posts to delete with full preview data for UI display.
 * This includes author info and additional fields needed for PostPreview component.
 */
export function calculatePostsToDeleteWithPreview(
  db: SQLiteDatabase,
  userDid: string,
  settings: AccountDeleteSettings
): PostToDeletePreview[] {
  if (!settings.deletePosts) {
    return [];
  }

  // Calculate the timestamp cutoff if days-old filter is enabled
  const daysOldTimestamp = settings.deletePostsDaysOldEnabled
    ? getTimestampDaysAgo(settings.deletePostsDaysOld)
    : null;

  // Build the WHERE clause dynamically
  let whereClause = `
    p.isRepost = 0
    AND p.deletedPostAt IS NULL
    AND p.preserve = 0
    AND p.authorDid = ?
  `;
  const params: (string | number)[] = [userDid];

  if (daysOldTimestamp) {
    whereClause += " AND p.createdAt <= ?";
    params.push(daysOldTimestamp);
  }

  if (settings.deletePostsLikesThresholdEnabled) {
    whereClause += " AND p.likeCount < ?";
    params.push(settings.deletePostsLikesThreshold);
  }

  if (settings.deletePostsRepostsThresholdEnabled) {
    whereClause += " AND p.repostCount < ?";
    params.push(settings.deletePostsRepostsThreshold);
  }

  // Get posts with author info via JOIN
  const candidatePosts = db.getAllSync<{
    uri: string;
    cid: string;
    text: string;
    createdAt: string;
    savedAt: number;
    likeCount: number;
    repostCount: number;
    replyCount: number;
    quoteCount: number;
    isReply: number;
    preserve: number;
    replyRootUri: string | null;
    authorDid: string;
    authorHandle: string | null;
    authorDisplayName: string | null;
    avatarUrl: string | null;
    avatarDataURI: string | null;
    embedJSON: string | null;
    quotedPostUri: string | null;
    facetsJSON: string | null;
  }>(
    `SELECT p.uri, p.cid, p.text, p.createdAt, p.savedAt,
            p.likeCount, p.repostCount, p.replyCount, p.quoteCount,
            p.isReply, p.preserve, p.replyRootUri, p.authorDid,
            p.embedJSON, p.quotedPostUri, p.facetsJSON,
            prof.handle as authorHandle, prof.displayName as authorDisplayName,
            prof.avatarUrl, prof.avatarDataURI
     FROM post p
     LEFT JOIN profile prof ON prof.did = p.authorDid
     WHERE ${whereClause}
     ORDER BY p.createdAt DESC;`,
    params
  );

  const mapPost = (post: (typeof candidatePosts)[0]): PostToDeletePreview => ({
    uri: post.uri,
    cid: post.cid,
    text: post.text,
    createdAt: post.createdAt,
    savedAt: post.savedAt,
    likeCount: post.likeCount,
    repostCount: post.repostCount,
    replyCount: post.replyCount,
    quoteCount: post.quoteCount,
    isReply: post.isReply === 1,
    preserve: post.preserve === 1,
    authorDid: post.authorDid,
    authorHandle: post.authorHandle,
    authorDisplayName: post.authorDisplayName,
    avatarUrl: post.avatarUrl,
    avatarDataURI: post.avatarDataURI,
    embedJSON: post.embedJSON,
    quotedPostUri: post.quotedPostUri,
    facetsJSON: post.facetsJSON,
  });

  if (!settings.deletePostsPreserveThreads) {
    return candidatePosts.map(mapPost);
  }

  // Thread preservation logic
  const preservedThreadRoots = findPreservedThreadRoots(db, userDid, settings);

  return candidatePosts
    .filter((post) => {
      const threadRoot = post.replyRootUri ?? post.uri;
      return !preservedThreadRoots.has(threadRoot);
    })
    .map(mapPost);
}

/**
 * Calculate posts for the deletion review UI.
 * Unlike calculatePostsToDeleteWithPreview, this INCLUDES preserved posts
 * so users can toggle preservation status in the review modal.
 *
 * This shows a "snapshot" of posts that match the deletion criteria
 * (regardless of preserve status), allowing users to toggle preserve on/off.
 */
export function calculatePostsForDeletionReview(
  db: SQLiteDatabase,
  userDid: string,
  settings: AccountDeleteSettings
): PostToDeletePreview[] {
  if (!settings.deletePosts) {
    return [];
  }

  // Calculate the timestamp cutoff if days-old filter is enabled
  const daysOldTimestamp = settings.deletePostsDaysOldEnabled
    ? getTimestampDaysAgo(settings.deletePostsDaysOld)
    : null;

  // Build the WHERE clause dynamically - NOTE: does NOT filter out preserved posts
  let whereClause = `
    p.isRepost = 0
    AND p.deletedPostAt IS NULL
    AND p.authorDid = ?
  `;
  const params: (string | number)[] = [userDid];

  if (daysOldTimestamp) {
    whereClause += " AND p.createdAt <= ?";
    params.push(daysOldTimestamp);
  }

  if (settings.deletePostsLikesThresholdEnabled) {
    whereClause += " AND p.likeCount < ?";
    params.push(settings.deletePostsLikesThreshold);
  }

  if (settings.deletePostsRepostsThresholdEnabled) {
    whereClause += " AND p.repostCount < ?";
    params.push(settings.deletePostsRepostsThreshold);
  }

  // Get posts with author info via JOIN
  const candidatePosts = db.getAllSync<{
    uri: string;
    cid: string;
    text: string;
    createdAt: string;
    savedAt: number;
    likeCount: number;
    repostCount: number;
    replyCount: number;
    quoteCount: number;
    isReply: number;
    preserve: number;
    replyRootUri: string | null;
    authorDid: string;
    authorHandle: string | null;
    authorDisplayName: string | null;
    avatarUrl: string | null;
    avatarDataURI: string | null;
    embedJSON: string | null;
    quotedPostUri: string | null;
    facetsJSON: string | null;
  }>(
    `SELECT p.uri, p.cid, p.text, p.createdAt, p.savedAt,
            p.likeCount, p.repostCount, p.replyCount, p.quoteCount,
            p.isReply, p.preserve, p.replyRootUri, p.authorDid,
            p.embedJSON, p.quotedPostUri, p.facetsJSON,
            prof.handle as authorHandle, prof.displayName as authorDisplayName,
            prof.avatarUrl, prof.avatarDataURI
     FROM post p
     LEFT JOIN profile prof ON prof.did = p.authorDid
     WHERE ${whereClause}
     ORDER BY p.createdAt DESC;`,
    params
  );

  const mapPost = (post: (typeof candidatePosts)[0]): PostToDeletePreview => ({
    uri: post.uri,
    cid: post.cid,
    text: post.text,
    createdAt: post.createdAt,
    savedAt: post.savedAt,
    likeCount: post.likeCount,
    repostCount: post.repostCount,
    replyCount: post.replyCount,
    quoteCount: post.quoteCount,
    isReply: post.isReply === 1,
    preserve: post.preserve === 1,
    authorDid: post.authorDid,
    authorHandle: post.authorHandle,
    authorDisplayName: post.authorDisplayName,
    avatarUrl: post.avatarUrl,
    avatarDataURI: post.avatarDataURI,
    embedJSON: post.embedJSON,
    quotedPostUri: post.quotedPostUri,
    facetsJSON: post.facetsJSON,
  });

  if (!settings.deletePostsPreserveThreads) {
    return candidatePosts.map(mapPost);
  }

  // Thread preservation logic - but still include preserved posts in results
  const preservedThreadRoots = findPreservedThreadRoots(db, userDid, settings);

  return candidatePosts
    .filter((post) => {
      const threadRoot = post.replyRootUri ?? post.uri;
      return !preservedThreadRoots.has(threadRoot);
    })
    .map(mapPost);
}

/**
 * Find all thread root URIs that should be preserved because at least one
 * post in the thread meets the engagement threshold criteria.
 */
function findPreservedThreadRoots(
  db: SQLiteDatabase,
  userDid: string,
  settings: AccountDeleteSettings
): Set<string> {
  // A thread should be preserved if any post by this user in the thread
  // meets at least one of the threshold criteria.

  // Build conditions for posts that meet the threshold
  const thresholdConditions: string[] = [];
  const thresholdParams: (string | number)[] = [userDid];

  if (settings.deletePostsLikesThresholdEnabled) {
    thresholdConditions.push("likeCount >= ?");
    thresholdParams.push(settings.deletePostsLikesThreshold);
  }

  if (settings.deletePostsRepostsThresholdEnabled) {
    thresholdConditions.push("repostCount >= ?");
    thresholdParams.push(settings.deletePostsRepostsThreshold);
  }

  if (thresholdConditions.length === 0) {
    // No threshold enabled, no threads to preserve
    return new Set();
  }

  // Apply days-old filter if enabled - we only preserve threads if the
  // post meeting the threshold is also within the age range being considered
  let ageClause = "";
  if (settings.deletePostsDaysOldEnabled) {
    const daysOldTimestamp = getTimestampDaysAgo(settings.deletePostsDaysOld);
    ageClause = " AND createdAt <= ?";
    thresholdParams.push(daysOldTimestamp);
  }

  // Query for posts that meet at least one threshold condition
  // Using COALESCE to handle null replyRootUri (meaning the post is its own thread root)
  const query = `
    SELECT DISTINCT COALESCE(replyRootUri, uri) as threadRoot
    FROM post
    WHERE isRepost = 0
      AND deletedPostAt IS NULL
      AND authorDid = ?
      AND (${thresholdConditions.join(" OR ")})
      ${ageClause};
  `;

  const rows = db.getAllSync<{ threadRoot: string }>(query, thresholdParams);

  return new Set(rows.map((r) => r.threadRoot));
}

/**
 * Calculate what reposts will be deleted based on the settings.
 */
export function calculateRepostsToDelete(
  db: SQLiteDatabase,
  _userDid: string,
  settings: AccountDeleteSettings
): RepostToDelete[] {
  if (!settings.deleteReposts) {
    return [];
  }

  let whereClause = `
    viewerReposted = 1
    AND deletedRepostAt IS NULL
  `;
  const params: (string | number)[] = [];

  if (settings.deleteRepostsDaysOldEnabled) {
    const daysOldTimestamp = getTimestampDaysAgo(settings.deleteRepostsDaysOld);
    whereClause += " AND createdAt <= ?";
    params.push(daysOldTimestamp);
  }

  return db.getAllSync<RepostToDelete>(
    `SELECT uri, repostUri, repostCid, createdAt, originalPostUri
     FROM post
     WHERE ${whereClause}
     ORDER BY createdAt ASC;`,
    params
  );
}

/**
 * Calculate what likes will be deleted based on the settings.
 */
export function calculateLikesToDelete(
  db: SQLiteDatabase,
  _userDid: string,
  settings: AccountDeleteSettings
): LikeToDelete[] {
  if (!settings.deleteLikes) {
    return [];
  }

  // Likes are stored as viewerLiked = 1 on posts
  // We need to find posts that the user has liked
  let whereClause = `
    viewerLiked = 1
    AND deletedLikeAt IS NULL
  `;
  const params: (string | number)[] = [];

  if (settings.deleteLikesDaysOldEnabled) {
    const daysOldTimestamp = getTimestampDaysAgo(settings.deleteLikesDaysOld);
    // For likes, we filter by when the post was created
    whereClause += " AND createdAt <= ?";
    params.push(daysOldTimestamp);
  }

  return db.getAllSync<LikeToDelete>(
    `SELECT p.uri, p.likeUri, p.createdAt, p.text, pr.handle as authorHandle
     FROM post p
     LEFT JOIN profile pr ON p.authorDid = pr.did
     WHERE ${whereClause}
     ORDER BY p.createdAt ASC;`,
    params
  );
}

/**
 * Calculate what messages will be deleted based on the settings.
 */
export function calculateMessagesToDelete(
  db: SQLiteDatabase,
  _userDid: string,
  settings: AccountDeleteSettings
): MessageToDelete[] {
  if (!settings.deleteChats) {
    return [];
  }

  // Messages are stored in the message table
  // Delete ALL messages in conversations (both sent and received)
  // The API deleteMessageForSelf removes messages from the user's view
  let whereClause = `
    m.deletedAt IS NULL
  `;
  const params: (string | number)[] = [];

  if (settings.deleteChatsDaysOldEnabled) {
    const daysOldTimestamp = getTimestampDaysAgo(settings.deleteChatsDaysOld);
    whereClause += " AND m.sentAt <= ?";
    params.push(daysOldTimestamp);
  }

  return db.getAllSync<MessageToDelete>(
    `SELECT m.messageId, m.convoId, m.text, m.sentAt
     FROM message m
     WHERE ${whereClause}
     ORDER BY m.sentAt ASC;`,
    params
  );
}

/**
 * Calculate what bookmarks will be deleted.
 * Bookmarks don't have date filtering options in the current settings.
 */
export function calculateBookmarksToDelete(
  db: SQLiteDatabase,
  settings: AccountDeleteSettings
): BookmarkToDelete[] {
  if (!settings.deleteBookmarks) {
    return [];
  }

  return db.getAllSync<BookmarkToDelete>(
    `SELECT id, subjectUri, postText
     FROM bookmark
     WHERE deletedAt IS NULL
     ORDER BY savedAt ASC;`
  );
}

/**
 * Calculate what follows will be unfollowed.
 */
export function calculateFollowsToUnfollow(
  db: SQLiteDatabase,
  settings: AccountDeleteSettings
): FollowToUnfollow[] {
  if (!settings.deleteUnfollowEveryone) {
    return [];
  }

  return db.getAllSync<FollowToUnfollow>(
    `SELECT uri, cid, subjectDid, handle, displayName
     FROM follow
     WHERE unfollowedAt IS NULL
     ORDER BY handle ASC;`
  );
}

/**
 * Calculate all deletion previews based on settings
 */
export function calculateDeletionPreview(
  db: SQLiteDatabase,
  userDid: string,
  settings: AccountDeleteSettings
): DeletionPreview {
  return {
    postsToDelete: calculatePostsToDelete(db, userDid, settings),
    repostsToDelete: calculateRepostsToDelete(db, userDid, settings),
    likesToDelete: calculateLikesToDelete(db, userDid, settings),
    messagesToDelete: calculateMessagesToDelete(db, userDid, settings),
    bookmarksToDelete: calculateBookmarksToDelete(db, settings),
    followsToUnfollow: calculateFollowsToUnfollow(db, settings),
  };
}

/**
 * Get summary counts of items to be deleted
 */
export function calculateDeletionPreviewCounts(
  db: SQLiteDatabase,
  userDid: string,
  settings: AccountDeleteSettings
): DeletionPreviewCounts {
  const preview = calculateDeletionPreview(db, userDid, settings);
  return {
    posts: preview.postsToDelete.length,
    reposts: preview.repostsToDelete.length,
    likes: preview.likesToDelete.length,
    messages: preview.messagesToDelete.length,
    bookmarks: preview.bookmarksToDelete.length,
    follows: preview.followsToUnfollow.length,
  };
}

import type { HeadersMap } from "@atproto/xrpc";

/**
 * Progress state for Bluesky save/delete operations
 */
export interface BlueskyProgress {
  // Index (save) progress
  postsSaved: number;
  postsTotal: number | null;
  likesSaved: number;
  likesTotal: number | null;
  bookmarksSaved: number;
  bookmarksTotal: number | null;
  followsSaved: number;
  followsTotal: number | null;
  conversationsSaved: number;
  conversationsTotal: number | null;
  messagesSaved: number;
  messagesTotal: number | null;

  // Delete progress
  postsDeleted: number;
  postsToDelete: number | null;
  repostsDeleted: number;
  repostsToDelete: number | null;
  likesDeleted: number;
  likesToDelete: number | null;
  bookmarksDeleted: number;
  bookmarksToDelete: number | null;
  messagesDeleted: number;
  messagesToDelete: number | null;
  unfollowed: number;
  toUnfollow: number | null;

  // Status
  currentAction: string;
  isRunning: boolean;
  error: string | null;
}

/**
 * Rate limit information from API responses
 */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: number; // Unix timestamp (seconds)
  isLimited: boolean;
}

/**
 * Database statistics for the account
 */
export interface BlueskyDatabaseStats {
  postsCount: number;
  repostsCount: number;
  likesCount: number;
  bookmarksCount: number;
  followsCount: number;
  conversationsCount: number;
  messagesCount: number;
  mediaDownloadedCount: number;
  deletedPostsCount: number;
  deletedRepostsCount: number;
  deletedLikesCount: number;
  deletedBookmarksCount: number;
  deletedMessagesCount: number;
  unfollowedCount: number;
}

/**
 * Options for deleting posts
 */
export interface DeletePostsOptions {
  olderThanDays?: number;
  minReposts?: number;
  minLikes?: number;
  excludeWithMedia?: boolean;
}

/**
 * Options for deleting reposts
 */
export interface DeleteRepostsOptions {
  olderThanDays?: number;
}

/**
 * Options for deleting likes
 */
export interface DeleteLikesOptions {
  olderThanDays?: number;
}

/**
 * Options for deleting messages
 */
export interface DeleteMessagesOptions {
  olderThanDays?: number;
}

export type ResponseHeaders = Headers | HeadersMap | undefined;

import type { HeadersMap } from "@atproto/xrpc";

/**
 * Progress state for a single job segment.
 * When unknownTotal is true, the total is unknown and the UI should show an animated
 * "indeterminate" state. When false, progress can be calculated as current/total.
 */
export interface JobProgressSegment {
  current: number;
  total: number | null;
  unknownTotal: boolean;
}

/**
 * Progress state for Bluesky save/delete operations
 */
export interface BlueskyProgress {
  // Index (save) progress - now uses segments
  postsProgress: JobProgressSegment;
  likesProgress: JobProgressSegment;
  bookmarksProgress: JobProgressSegment;
  followsProgress: JobProgressSegment;
  conversationsProgress: JobProgressSegment;
  messagesProgress: JobProgressSegment;

  // Delete progress - these have known totals
  deletePostsProgress: JobProgressSegment;
  deleteRepostsProgress: JobProgressSegment;
  deleteLikesProgress: JobProgressSegment;
  deleteBookmarksProgress: JobProgressSegment;
  deleteMessagesProgress: JobProgressSegment;
  unfollowProgress: JobProgressSegment;

  // Preview post for display (legacy, prefer previewData)
  previewPost?: AutomationPostPreviewData | null;

  // Unified preview data for posts, conversations, or messages
  previewData?: AutomationPreviewData | null;

  // Status
  currentAction: string;
  isRunning: boolean;
  error: string | null;
}

/**
 * Helper to create an initial progress segment
 */
export function createProgressSegment(
  unknownTotal: boolean = false
): JobProgressSegment {
  return { current: 0, total: null, unknownTotal };
}

/**
 * Helper to create initial BlueskyProgress state
 */
export function createInitialProgress(): BlueskyProgress {
  return {
    postsProgress: createProgressSegment(true), // Unknown total for indexing
    likesProgress: createProgressSegment(true),
    bookmarksProgress: createProgressSegment(true),
    followsProgress: createProgressSegment(true),
    conversationsProgress: createProgressSegment(true),
    messagesProgress: createProgressSegment(true),
    deletePostsProgress: createProgressSegment(false), // Known totals for deletion
    deleteRepostsProgress: createProgressSegment(false),
    deleteLikesProgress: createProgressSegment(false),
    deleteBookmarksProgress: createProgressSegment(false),
    deleteMessagesProgress: createProgressSegment(false),
    unfollowProgress: createProgressSegment(false),
    previewPost: null,
    previewData: null,
    currentAction: "",
    isRunning: false,
    error: null,
  };
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

export type AutomationMediaAttachment = {
  type: "image" | "video";
  thumbUrl?: string | null;
  fullsizeUrl?: string | null;
  playlistUrl?: string | null;
  localThumbPath?: string | null;
  localFullsizePath?: string | null;
  localVideoPath?: string | null;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
};

export type AutomationPostPreviewData = {
  uri: string;
  cid: string;
  text: string;
  createdAt: string;
  author: {
    did: string;
    handle: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    avatarDataURI?: string | null;
  };
  likeCount?: number | null;
  repostCount?: number | null;
  replyCount?: number | null;
  quoteCount?: number | null;
  isRepost?: boolean;
  quotedPostUri?: string | null;
  media?: AutomationMediaAttachment[];
};

/**
 * Author/participant info for preview components
 */
export type AutomationProfileData = {
  did: string;
  handle: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  avatarDataURI?: string | null;
};

/**
 * Preview data for a chat conversation
 */
export type AutomationConversationPreviewData = {
  convoId: string;
  lastMessageText?: string | null;
  lastMessageSentAt?: string | null;
  unreadCount?: number;
  muted?: boolean;
  members: AutomationProfileData[];
};

/**
 * Preview data for a chat message
 */
export type AutomationMessagePreviewData = {
  messageId: string;
  convoId: string;
  text: string;
  sentAt: string;
  sender: AutomationProfileData;
};

/**
 * Union type for all preview data types
 */
export type AutomationPreviewData =
  | { type: "post"; data: AutomationPostPreviewData }
  | { type: "conversation"; data: AutomationConversationPreviewData }
  | { type: "message"; data: AutomationMessagePreviewData };

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

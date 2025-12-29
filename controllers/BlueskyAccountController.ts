import {
  Agent,
  type AppBskyActorDefs,
  type AppBskyFeedGetAuthorFeed,
  AppBskyFeedPost,
  AppBskyFeedRepost,
} from "@atproto/api";
import type { OAuthSession } from "@atproto/oauth-client";
import type { HeadersMap } from "@atproto/xrpc";

import { getDatabase } from "@/database";
import {
  applyAccountMigrations,
  blueskyAccountMigrations,
} from "@/database/account-db";
import { BaseAccountController } from "./BaseAccountController";

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

type FeedViewPost = AppBskyFeedGetAuthorFeed.OutputSchema["feed"][number];
type FeedPostView = FeedViewPost["post"];
type FeedRecordInfo =
  | { kind: "post"; record: AppBskyFeedPost.Record }
  | { kind: "repost"; record: AppBskyFeedRepost.Record };

type ResponseHeaders = Headers | HeadersMap | undefined;

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

/**
 * Controller for managing a Bluesky account's data archive.
 * Handles saving posts, likes, bookmarks, follows, and DMs,
 * as well as delete operations.
 */
export class BlueskyAccountController extends BaseAccountController<BlueskyProgress> {
  private agent: Agent | null = null;
  private did: string | null = null;
  private handle: string | null = null;

  private rateLimitInfo: RateLimitInfo = {
    limit: 3000,
    remaining: 3000,
    resetAt: 0,
    isLimited: false,
  };

  private sessionExpiredCallback?: () => Promise<void>;
  private rateLimitCallback?: (info: RateLimitInfo) => void;
  private progressCallback?: (progress: BlueskyProgress) => void;

  getAccountType(): string {
    return "bluesky";
  }

  resetProgress(): BlueskyProgress {
    return {
      postsSaved: 0,
      postsTotal: null,
      likesSaved: 0,
      likesTotal: null,
      bookmarksSaved: 0,
      bookmarksTotal: null,
      followsSaved: 0,
      followsTotal: null,
      conversationsSaved: 0,
      conversationsTotal: null,
      messagesSaved: 0,
      messagesTotal: null,
      postsDeleted: 0,
      postsToDelete: null,
      repostsDeleted: 0,
      repostsToDelete: null,
      likesDeleted: 0,
      likesToDelete: null,
      bookmarksDeleted: 0,
      bookmarksToDelete: null,
      messagesDeleted: 0,
      messagesToDelete: null,
      unfollowed: 0,
      toUnfollow: null,
      currentAction: "",
      isRunning: false,
      error: null,
    };
  }

  /**
   * Initialize the account-specific database
   */
  async initDB(): Promise<void> {
    this.db = await this.openAccountDatabase();
    applyAccountMigrations(this.db, blueskyAccountMigrations);
    await this.updateAccessedAt();
  }

  /**
   * Initialize the authenticated API agent
   */
  async initAgent(): Promise<void> {
    const mainDb = await getDatabase();

    // Get the session from the main database
    const row = await mainDb.getFirstAsync<{
      did: string;
      handle: string;
      sessionJson: string | null;
    }>(
      `SELECT b.did, b.handle, b.sessionJson
       FROM account a
       INNER JOIN bsky_account b ON b.id = a.bskyAccountID
       WHERE a.id = ?;`,
      [this.accountId]
    );

    if (!row) {
      throw new Error("Account not found");
    }

    if (!row.sessionJson) {
      throw new Error("No session found for account");
    }

    this.did = row.did;
    this.handle = row.handle;

    // Parse the session and create an agent
    // Note: Full OAuth session restoration requires the OAuthClient
    // For now, we'll need to re-authenticate if the session is expired
    const session = JSON.parse(row.sessionJson) as OAuthSession;

    // Create agent - this is a simplified version
    // Full implementation will need to restore the OAuth session properly
    this.agent = new Agent(session);
  }

  /**
   * Set callback for when the session expires
   */
  setSessionExpiredCallback(callback: () => Promise<void>): void {
    this.sessionExpiredCallback = callback;
  }

  /**
   * Set callback for rate limit updates
   */
  setRateLimitCallback(callback: (info: RateLimitInfo) => void): void {
    this.rateLimitCallback = callback;
  }

  /**
   * Set callback for progress updates
   */
  setProgressCallback(callback: (progress: BlueskyProgress) => void): void {
    this.progressCallback = callback;
  }

  /**
   * Update progress and notify listeners
   */
  protected updateProgress(updates: Partial<BlueskyProgress>): void {
    this._progress = { ...this._progress, ...updates };
    this.progressCallback?.(this._progress);
  }

  /**
   * Get the current rate limit info
   */
  getRateLimitInfo(): RateLimitInfo {
    return { ...this.rateLimitInfo };
  }

  /**
   * Get the DID for this account
   */
  getDid(): string | null {
    return this.did;
  }

  /**
   * Get the handle for this account
   */
  getHandle(): string | null {
    return this.handle;
  }

  /**
   * Check if the agent is initialized
   */
  isAgentReady(): boolean {
    return this.agent !== null;
  }

  /**
   * Refresh the session after re-authentication
   */
  async refreshSession(newSession: OAuthSession): Promise<void> {
    const mainDb = await getDatabase();

    await mainDb.runAsync(
      `UPDATE bsky_account 
       SET sessionJson = ?, updatedAt = ?
       WHERE id = (SELECT bskyAccountID FROM account WHERE id = ?);`,
      [JSON.stringify(newSession), Date.now(), this.accountId]
    );

    // Reinitialize the agent
    this.agent = new Agent(newSession);
  }

  /**
   * Get the user's profile from the API
   */
  async getProfile(): Promise<AppBskyActorDefs.ProfileViewDetailed | null> {
    if (!this.agent || !this.did) {
      return null;
    }

    const response = await this.agent.getProfile({ actor: this.did });
    return response.data;
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats(): Promise<BlueskyDatabaseStats> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    const stats = {
      postsCount: 0,
      repostsCount: 0,
      likesCount: 0,
      bookmarksCount: 0,
      followsCount: 0,
      conversationsCount: 0,
      messagesCount: 0,
      mediaDownloadedCount: 0,
      deletedPostsCount: 0,
      deletedRepostsCount: 0,
      deletedLikesCount: 0,
      deletedBookmarksCount: 0,
      deletedMessagesCount: 0,
      unfollowedCount: 0,
    };

    const counts = this.db.getFirstSync<{
      posts: number;
      reposts: number;
      deletedPosts: number;
      deletedReposts: number;
    }>(`
      SELECT 
        COUNT(*) FILTER (WHERE isRepost = 0 AND deletedPostAt IS NULL) as posts,
        COUNT(*) FILTER (WHERE isRepost = 1 AND deletedRepostAt IS NULL) as reposts,
        COUNT(*) FILTER (WHERE deletedPostAt IS NOT NULL) as deletedPosts,
        COUNT(*) FILTER (WHERE deletedRepostAt IS NOT NULL) as deletedReposts
      FROM post;
    `);

    if (counts) {
      stats.postsCount = counts.posts;
      stats.repostsCount = counts.reposts;
      stats.deletedPostsCount = counts.deletedPosts;
      stats.deletedRepostsCount = counts.deletedReposts;
    }

    const likeCounts = this.db.getFirstSync<{
      total: number;
      deleted: number;
    }>(`
      SELECT 
        COUNT(*) FILTER (WHERE deletedAt IS NULL) as total,
        COUNT(*) FILTER (WHERE deletedAt IS NOT NULL) as deleted
      FROM like_record;
    `);

    if (likeCounts) {
      stats.likesCount = likeCounts.total;
      stats.deletedLikesCount = likeCounts.deleted;
    }

    const bookmarkCounts = this.db.getFirstSync<{
      total: number;
      deleted: number;
    }>(`
      SELECT 
        COUNT(*) FILTER (WHERE deletedAt IS NULL) as total,
        COUNT(*) FILTER (WHERE deletedAt IS NOT NULL) as deleted
      FROM bookmark;
    `);

    if (bookmarkCounts) {
      stats.bookmarksCount = bookmarkCounts.total;
      stats.deletedBookmarksCount = bookmarkCounts.deleted;
    }

    const followCounts = this.db.getFirstSync<{
      total: number;
      unfollowed: number;
    }>(`
      SELECT 
        COUNT(*) FILTER (WHERE unfollowedAt IS NULL) as total,
        COUNT(*) FILTER (WHERE unfollowedAt IS NOT NULL) as unfollowed
      FROM follow;
    `);

    if (followCounts) {
      stats.followsCount = followCounts.total;
      stats.unfollowedCount = followCounts.unfollowed;
    }

    const convoCounts = this.db.getFirstSync<{ total: number }>(`
      SELECT COUNT(*) as total FROM conversation WHERE leftAt IS NULL;
    `);

    if (convoCounts) {
      stats.conversationsCount = convoCounts.total;
    }

    const messageCounts = this.db.getFirstSync<{
      total: number;
      deleted: number;
    }>(`
      SELECT 
        COUNT(*) FILTER (WHERE deletedAt IS NULL) as total,
        COUNT(*) FILTER (WHERE deletedAt IS NOT NULL) as deleted
      FROM message;
    `);

    if (messageCounts) {
      stats.messagesCount = messageCounts.total;
      stats.deletedMessagesCount = messageCounts.deleted;
    }

    const mediaCounts = this.db.getFirstSync<{ total: number }>(`
      SELECT COUNT(*) as total FROM post_media WHERE downloadedAt IS NOT NULL;
    `);

    if (mediaCounts) {
      stats.mediaDownloadedCount = mediaCounts.total;
    }

    return stats;
  }

  // ==================== Rate Limit & Session Handling ====================

  /**
   * Update rate limit info from API response headers
   */
  private updateRateLimitFromHeaders(headers: ResponseHeaders): void {
    const limit = this.getHeaderValue(headers, "ratelimit-limit");
    const remaining = this.getHeaderValue(headers, "ratelimit-remaining");
    const reset = this.getHeaderValue(headers, "ratelimit-reset");

    if (limit) this.rateLimitInfo.limit = parseInt(limit, 10);
    if (remaining) this.rateLimitInfo.remaining = parseInt(remaining, 10);
    if (reset) this.rateLimitInfo.resetAt = parseInt(reset, 10);

    if (limit || remaining || reset) {
      this.rateLimitCallback?.(this.rateLimitInfo);
    }
  }

  private getHeaderValue(headers: ResponseHeaders, key: string): string | null {
    if (!headers) {
      return null;
    }

    if (headers instanceof Headers) {
      return headers.get(key);
    }

    const normalizedKey = key.toLowerCase();
    const value = headers[key] ?? headers[normalizedKey];
    return value ?? null;
  }

  /**
   * Check if an error indicates the session has expired
   */
  private isSessionExpiredError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;

    const err = error as { status?: number; error?: string; message?: string };

    return (
      err.status === 401 ||
      err.error === "ExpiredToken" ||
      err.error === "InvalidToken" ||
      (typeof err.message === "string" &&
        (err.message.includes("token") || err.message.includes("expired")))
    );
  }

  /**
   * Check if an error indicates rate limiting
   */
  private isRateLimitError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;

    const err = error as { status?: number };
    return err.status === 429;
  }

  /**
   * Handle rate limit by waiting until reset time
   */
  private async handleRateLimit(error?: unknown): Promise<void> {
    // Extract reset time from error or use existing info
    let resetAt = this.rateLimitInfo.resetAt;

    if (error && typeof error === "object") {
      const err = error as { headers?: Headers | HeadersMap };
      const reset = this.getHeaderValue(err.headers, "ratelimit-reset");
      if (reset) {
        resetAt = parseInt(reset, 10);
      }
    }

    // If no valid reset time, default to 5 minutes from now
    const now = Math.floor(Date.now() / 1000);
    if (!resetAt || resetAt < now) {
      resetAt = now + 300;
    }

    this.rateLimitInfo.isLimited = true;
    this.rateLimitInfo.resetAt = resetAt;

    // Notify UI
    this.rateLimitCallback?.(this.rateLimitInfo);

    // Wait until rate limit expires with countdown updates
    await this.waitForRateLimitReset(resetAt);

    this.rateLimitInfo.isLimited = false;
    this.updateProgress({ currentAction: "Resuming..." });
  }

  /**
   * Wait for rate limit to reset, updating progress with countdown
   */
  private waitForRateLimitReset(resetAt: number): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const now = Math.floor(Date.now() / 1000);
        const remaining = resetAt - now;

        if (remaining <= 0) {
          clearInterval(checkInterval);
          resolve();
        } else {
          // Update progress with countdown
          this.updateProgress({
            currentAction: `Rate limited. Resuming in ${remaining}s...`,
          });
          this.rateLimitCallback?.({
            ...this.rateLimitInfo,
            resetAt,
          });
        }
      }, 1000);
    });
  }

  /**
   * Make an authenticated API request with session expiration handling.
   * If the session expires, pauses and waits for re-authentication.
   */
  protected async makeAuthenticatedRequest<T>(
    requestFn: () => Promise<T>
  ): Promise<T> {
    try {
      return await requestFn();
    } catch (error) {
      if (this.isSessionExpiredError(error)) {
        // Pause operation, notify UI
        this.updateProgress({
          currentAction: "Waiting for re-authentication...",
          isRunning: false,
        });

        if (this.sessionExpiredCallback) {
          await this.sessionExpiredCallback();
          // After re-auth, retry the request
          return await requestFn();
        } else {
          throw new Error("Session expired and no callback provided");
        }
      }
      throw error;
    }
  }

  /**
   * Make an API request with rate limit handling.
   * Automatically waits and retries when rate limited.
   */
  protected async makeApiRequest<T>(
    requestFn: () => Promise<{ data: T; headers?: Headers | HeadersMap }>
  ): Promise<T> {
    // Check if we're already rate limited before making request
    if (this.rateLimitInfo.isLimited) {
      await this.handleRateLimit();
    }

    try {
      const response = await this.makeAuthenticatedRequest(requestFn);

      // Update rate limit tracking from response headers
      this.updateRateLimitFromHeaders(response.headers);

      return response.data;
    } catch (error) {
      // Handle rate limit errors
      if (this.isRateLimitError(error)) {
        await this.handleRateLimit(error);
        // Retry after waiting
        return this.makeApiRequest(requestFn);
      }
      throw error;
    }
  }

  // ==================== Save Operations ====================
  // These will be implemented in Phase 3

  /**
   * Index (save) the user's posts
   */
  async indexPosts(): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    if (!this.agent || !this.did) {
      throw new Error("Agent not initialized");
    }

    this.updateProgress({
      postsSaved: 0,
      postsTotal: null,
      currentAction: "Indexing posts...",
      isRunning: true,
      error: null,
    });

    const pageSize = 100;
    let cursor: string | undefined;
    let totalSaved = 0;

    try {
      while (true) {
        const response = await this.makeApiRequest(() =>
          this.agent!.app.bsky.feed.getAuthorFeed({
            actor: this.did!,
            cursor,
            limit: pageSize,
          })
        );

        const feed = response.feed ?? [];
        const nextCursor = response.cursor;

        if (feed.length > 0) {
          const savedCount = await this.saveFeedPosts(feed);
          totalSaved += savedCount;

          this.updateProgress({
            postsSaved: totalSaved,
            currentAction: `Indexed ${totalSaved} posts`,
          });
        }

        if (!nextCursor) {
          break;
        }

        cursor = nextCursor;
      }

      this.updateProgress({
        postsSaved: totalSaved,
        postsTotal: totalSaved,
        currentAction: "Post indexing complete",
        isRunning: false,
      });
    } catch (error) {
      this.updateProgress({
        isRunning: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  private async saveFeedPosts(feed: FeedViewPost[]): Promise<number> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    const db = this.db;
    let saved = 0;
    await db.withTransactionAsync(async () => {
      for (const item of feed) {
        const postView = item.post;
        const recordInfo = this.getRecordInfo(postView.record);
        if (!recordInfo) {
          continue;
        }

        await this.upsertProfile(postView.author);

        const postRecord =
          recordInfo.kind === "post" ? recordInfo.record : null;
        const repostRecord =
          recordInfo.kind === "repost" ? recordInfo.record : null;
        const now = Date.now();

        const text = postRecord?.text ?? "";
        const facetsJSON =
          postRecord?.facets && postRecord.facets.length > 0
            ? JSON.stringify(postRecord.facets)
            : null;
        const embedType = postView.embed?.$type ?? null;
        const embedJSON = postView.embed
          ? JSON.stringify(postView.embed)
          : null;
        const langs =
          postRecord?.langs && postRecord.langs.length > 0
            ? postRecord.langs.join(",")
            : null;

        const replyParentUri = postRecord?.reply?.parent?.uri ?? null;
        const replyRootUri = postRecord?.reply?.root?.uri ?? null;
        const isReply = postRecord?.reply ? 1 : 0;

        const quotedPostUri = postRecord
          ? this.extractQuotedPostUri(postView.embed)
          : null;
        const isQuote = quotedPostUri ? 1 : 0;

        const isRepost = recordInfo.kind === "repost" ? 1 : 0;
        const repostUri = isRepost ? postView.uri : null;
        const repostCid = isRepost ? postView.cid : null;
        const originalPostUri = repostRecord ? repostRecord.subject.uri : null;

        await db.runAsync(
          `INSERT INTO post (
            uri, cid, authorDid,
            text, facetsJSON, embedType, embedJSON, langs,
            isReply, replyParentUri, replyRootUri,
            isQuote, quotedPostUri,
            isRepost, repostUri, repostCid, originalPostUri,
            likeCount, repostCount, replyCount, quoteCount,
            viewerLiked, viewerReposted, viewerBookmarked,
            createdAt, savedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(uri) DO UPDATE SET
            cid = excluded.cid,
            authorDid = excluded.authorDid,
            text = excluded.text,
            facetsJSON = excluded.facetsJSON,
            embedType = excluded.embedType,
            embedJSON = excluded.embedJSON,
            langs = excluded.langs,
            isReply = excluded.isReply,
            replyParentUri = excluded.replyParentUri,
            replyRootUri = excluded.replyRootUri,
            isQuote = excluded.isQuote,
            quotedPostUri = excluded.quotedPostUri,
            isRepost = excluded.isRepost,
            repostUri = excluded.repostUri,
            repostCid = excluded.repostCid,
            originalPostUri = excluded.originalPostUri,
            likeCount = excluded.likeCount,
            repostCount = excluded.repostCount,
            replyCount = excluded.replyCount,
            quoteCount = excluded.quoteCount,
            viewerLiked = excluded.viewerLiked,
            viewerReposted = excluded.viewerReposted,
            viewerBookmarked = excluded.viewerBookmarked,
            createdAt = excluded.createdAt,
            savedAt = excluded.savedAt;`,
          [
            postView.uri,
            postView.cid,
            postView.author.did,
            text,
            facetsJSON,
            embedType,
            embedJSON,
            langs,
            isReply,
            replyParentUri,
            replyRootUri,
            isQuote,
            quotedPostUri,
            isRepost,
            repostUri,
            repostCid,
            originalPostUri,
            postView.likeCount ?? 0,
            postView.repostCount ?? 0,
            postView.replyCount ?? 0,
            postView.quoteCount ?? 0,
            postView.viewer?.like ? 1 : 0,
            postView.viewer?.repost ? 1 : 0,
            postView.viewer?.bookmarked ? 1 : 0,
            postRecord?.createdAt ??
              repostRecord?.createdAt ??
              postView.indexedAt,
            now,
          ]
        );

        saved += 1;
      }
    });

    return saved;
  }

  private async upsertProfile(
    profile: AppBskyActorDefs.ProfileViewBasic
  ): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    const now = Date.now();
    const description =
      (profile as { description?: string }).description ?? null;

    await this.db.runAsync(
      `INSERT INTO profile (
        did, handle, displayName, avatarUrl, avatarLocalPath, avatarDataURI, description, savedAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(did) DO UPDATE SET
        handle = excluded.handle,
        displayName = excluded.displayName,
        avatarUrl = excluded.avatarUrl,
        description = excluded.description,
        updatedAt = excluded.updatedAt;`,
      [
        profile.did,
        profile.handle,
        profile.displayName ?? null,
        profile.avatar ?? null,
        null,
        null,
        description,
        now,
        now,
      ]
    );
  }

  private isPostRecord(
    record: FeedPostView["record"]
  ): record is AppBskyFeedPost.Record {
    return AppBskyFeedPost.isRecord(record as Record<string, unknown>);
  }

  private isRepostRecord(
    record: FeedPostView["record"]
  ): record is AppBskyFeedRepost.Record {
    return AppBskyFeedRepost.isRecord(record as Record<string, unknown>);
  }

  private getRecordInfo(record: FeedPostView["record"]): FeedRecordInfo | null {
    if (this.isPostRecord(record)) {
      return { kind: "post", record };
    }

    if (this.isRepostRecord(record)) {
      return { kind: "repost", record };
    }

    return null;
  }

  private extractQuotedPostUri(
    embed: FeedPostView["embed"] | undefined
  ): string | null {
    const findUri = (value: unknown, depth = 0): string | null => {
      if (!value || typeof value !== "object" || depth > 4) {
        return null;
      }

      const candidate = value as Record<string, unknown>;
      if (typeof candidate.uri === "string") {
        return candidate.uri;
      }

      if (candidate.record) {
        return findUri(candidate.record, depth + 1);
      }

      return null;
    };

    return findUri(embed);
  }

  /**
   * Index (save) the user's likes
   */
  async indexLikes(): Promise<void> {
    // TODO: Implement in Phase 3
    throw new Error("Not implemented yet");
  }

  /**
   * Index (save) the user's bookmarks
   */
  async indexBookmarks(): Promise<void> {
    // TODO: Implement in Phase 3
    throw new Error("Not implemented yet");
  }

  /**
   * Index (save) the accounts the user follows
   */
  async indexFollowing(): Promise<void> {
    // TODO: Implement in Phase 3
    throw new Error("Not implemented yet");
  }

  /**
   * Index (save) the user's conversations
   */
  async indexConversations(): Promise<void> {
    // TODO: Implement in Phase 3
    throw new Error("Not implemented yet");
  }

  /**
   * Index (save) messages in a conversation
   */
  async indexMessages(_convoId: string): Promise<void> {
    // TODO: Implement in Phase 3
    throw new Error("Not implemented yet");
  }

  // ==================== Delete Operations ====================
  // These will be implemented in Phase 6

  /**
   * Delete posts matching the given options
   */
  async deletePosts(_options: DeletePostsOptions): Promise<void> {
    // TODO: Implement in Phase 6
    throw new Error("Not implemented yet");
  }

  /**
   * Delete reposts matching the given options
   */
  async deleteReposts(_options: DeleteRepostsOptions): Promise<void> {
    // TODO: Implement in Phase 6
    throw new Error("Not implemented yet");
  }

  /**
   * Delete likes matching the given options
   */
  async deleteLikes(_options: DeleteLikesOptions): Promise<void> {
    // TODO: Implement in Phase 6
    throw new Error("Not implemented yet");
  }

  /**
   * Delete all bookmarks
   */
  async deleteBookmarks(): Promise<void> {
    // TODO: Implement in Phase 6
    throw new Error("Not implemented yet");
  }

  /**
   * Delete messages matching the given options
   */
  async deleteMessages(_options: DeleteMessagesOptions): Promise<void> {
    // TODO: Implement in Phase 6
    throw new Error("Not implemented yet");
  }

  /**
   * Unfollow all accounts
   */
  async unfollowAll(): Promise<void> {
    // TODO: Implement in Phase 6
    throw new Error("Not implemented yet");
  }

  // ==================== Media Operations ====================
  // These will be implemented in Phase 4

  /**
   * Download media blob and return local file path
   */
  async downloadMedia(_blobCid: string, _did: string): Promise<string> {
    // TODO: Implement in Phase 4
    throw new Error("Not implemented yet");
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    this.agent = null;
    this.did = null;
    this.handle = null;
    await super.cleanup();
  }
}

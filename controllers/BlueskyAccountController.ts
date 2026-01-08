import { Agent, type AppBskyActorDefs } from "@atproto/api";
import type { OAuthSession } from "@atproto/oauth-client";
import { Directory, File, Paths } from "expo-file-system";

import { getDatabase } from "@/database";
import {
  applyAccountMigrations,
  blueskyAccountMigrations,
} from "@/database/account-db";
import type { AccountDeleteSettings } from "@/database/delete-settings";
import { restoreBlueskyOAuthSession } from "@/services/bluesky-oauth";
import {
  BaseAccountController,
  buildAccountPaths,
} from "./BaseAccountController";
import {
  calculateBookmarksToDelete,
  calculateDeletionPreview,
  calculateDeletionPreviewCounts,
  calculateFollowsToUnfollow,
  calculateLikesToDelete,
  calculateMessagesToDelete,
  calculatePostsForDeletionReview,
  calculatePostsToDelete,
  calculatePostsToDeleteWithPreview,
  calculateRepostsToDelete,
  type DeletionPreview,
  type DeletionPreviewCounts,
  type PostToDeletePreview,
} from "./bluesky/deletion-calculator";
import { BlueskyIndexer } from "./bluesky/indexer";
import { mapJobRow, type JobRow } from "./bluesky/job-helpers";
import { runJob } from "./bluesky/job-runner";
import {
  type BlueskyJobRecord,
  type BlueskyJobRunUpdate,
  type BlueskyJobStatus,
  type BlueskyJobType,
  type DeleteJobOptions,
  type JobEmit,
  type SaveJobOptions,
} from "./bluesky/job-types";
import { BlueskyRateLimiter, type ApiRequestFn } from "./bluesky/rate-limiter";
import type {
  BlueskyDatabaseStats,
  BlueskyProgress,
  DeleteLikesOptions,
  DeleteMessagesOptions,
  DeletePostsOptions,
  DeleteRepostsOptions,
  RateLimitInfo,
} from "./bluesky/types";
import { createInitialProgress } from "./bluesky/types";

type FetchRequestInfo = string | URL | Request;

function isRequestLike(value: unknown): value is Request {
  return (
    typeof value === "object" &&
    value !== null &&
    "url" in value &&
    typeof (value as { url?: unknown }).url === "string"
  );
}

function normalizeFetchUrl(input: FetchRequestInfo): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (isRequestLike(input)) {
    return input.url;
  }
  throw new Error("Unable to normalize fetch request URL");
}

export type {
  BlueskyDatabaseStats,
  BlueskyProgress,
  DeleteLikesOptions,
  DeleteMessagesOptions,
  DeletePostsOptions,
  DeleteRepostsOptions,
  RateLimitInfo,
} from "./bluesky/types";

export type {
  BookmarkToDelete,
  DeletionPreview,
  DeletionPreviewCounts,
  FollowToUnfollow,
  LikeToDelete,
  MessageToDelete,
  PostToDelete,
  PostToDeletePreview,
  RepostToDelete,
} from "./bluesky/deletion-calculator";

/**
 * Controller for managing a Bluesky account's data archive.
 * Handles saving posts, likes, bookmarks, follows, and DMs,
 * as well as delete operations.
 */
export class BlueskyAccountController extends BaseAccountController<BlueskyProgress> {
  private agent: Agent | null = null;
  private did: string | null = null;
  private handle: string | null = null;
  private readonly rateLimiter: BlueskyRateLimiter;
  private readonly indexer: BlueskyIndexer;
  private sessionExpiredCallback?: () => Promise<void>;
  private rateLimitCallback?: (info: RateLimitInfo) => void;
  private progressCallback?: (progress: BlueskyProgress) => void;
  private deleteSettings: AccountDeleteSettings | null = null;

  constructor(accountId: number, accountUUID?: string) {
    super(accountId, accountUUID);

    this.rateLimiter = new BlueskyRateLimiter({
      onProgressUpdate: (updates) => this.updateProgress(updates),
      getSessionExpiredCallback: () => this.sessionExpiredCallback,
    });

    this.indexer = new BlueskyIndexer({
      getDb: () => this.db,
      getAgent: () => this.agent,
      getDid: () => this.did,
      updateProgress: (updates) => this.updateProgress(updates),
      waitForPause: () => this.waitForPause(),
      makeApiRequest: <T>(requestFn: ApiRequestFn<T>) =>
        this.makeApiRequest<T>(requestFn),
      downloadMediaFromUrl: (url: string, did: string) =>
        this.downloadMediaFromUrl(url, did),
    });
  }

  getAccountType(): string {
    return "bluesky";
  }

  resetProgress(): BlueskyProgress {
    return createInitialProgress();
  }

  /**
   * Initialize the account-specific database
   */
  async initDB(): Promise<void> {
    console.log("[BlueskyController] initDB -> start", this.accountId);
    this.db = await this.openAccountDatabase();
    applyAccountMigrations(this.db, blueskyAccountMigrations);
    await this.updateAccessedAt();
    console.log("[BlueskyController] initDB -> done", this.accountId);
  }

  /**
   * Initialize the authenticated API agent
   */
  async initAgent(): Promise<void> {
    console.log("[BlueskyController] initAgent -> start", this.accountId);
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

    this.did = row.did;
    this.handle = row.handle;
    if (!this.did) {
      throw new Error("No DID found for account");
    }

    const session = await restoreBlueskyOAuthSession(this.did);
    const sessionFetch = session.fetchHandler.bind(session);
    this.agent = new Agent({
      did: session.did,
      fetchHandler: (url, init) => {
        const target = normalizeFetchUrl(url);
        return sessionFetch(target, init);
      },
    });
    console.log(
      "[BlueskyController] initAgent -> ready",
      this.accountId,
      this.did,
      this.handle
    );
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
    this.rateLimiter.setRateLimitCallback(callback);
  }

  /**
   * Set callback for progress updates
   */
  setProgressCallback(callback: (progress: BlueskyProgress) => void): void {
    this.progressCallback = callback;
  }

  /**
   * Clear the progress callback
   */
  clearProgressCallback(): void {
    this.progressCallback = undefined;
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
    return this.rateLimiter.getInfo();
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

    const sessionFetch = newSession.fetchHandler.bind(newSession);
    this.agent = new Agent({
      did: newSession.did,
      fetchHandler: (url, init) => {
        const target = normalizeFetchUrl(url);
        return sessionFetch(target, init);
      },
    });
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
        COUNT(*) FILTER (WHERE viewerLiked = 1 AND deletedLikeAt IS NULL) as total,
        COUNT(*) FILTER (WHERE deletedLikeAt IS NOT NULL) as deleted
      FROM post;
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

  protected makeApiRequest<T>(requestFn: ApiRequestFn<T>): Promise<T> {
    return this.rateLimiter.makeApiRequest(requestFn);
  }

  // ==================== Job Management ====================

  async defineJobs(options: SaveJobOptions): Promise<BlueskyJobRecord[]> {
    console.log("[BlueskyController] defineJobs -> start", this.accountId, {
      posts: options.posts,
      likes: options.likes,
      bookmarks: options.bookmarks,
      chat: options.chat,
    });
    const db = this.requireDb();
    const scheduledAt = Date.now();
    const jobTypes: BlueskyJobType[] = ["verifyAuthorization"];

    if (options.posts) {
      jobTypes.push("savePosts");
    }

    if (options.likes) {
      jobTypes.push("saveLikes");
    }

    if (options.bookmarks) {
      jobTypes.push("saveBookmarks");
    }

    if (options.chat) {
      jobTypes.push("saveChatConvos");
      jobTypes.push("saveChatMessages");
    }

    const inserted: BlueskyJobRecord[] = [];

    for (const jobType of jobTypes) {
      const result = await db.runAsync(
        `INSERT INTO job (jobType, status, scheduledAt, progressJSON) VALUES (?, 'pending', ?, NULL);`,
        [jobType, scheduledAt]
      );
      const id = Number(result.lastInsertRowId);
      inserted.push({
        id,
        jobType,
        status: "pending",
        scheduledAt,
        startedAt: null,
        finishedAt: null,
        progress: undefined,
        error: null,
      });
    }

    console.log(
      "[BlueskyController] defineJobs -> inserted",
      this.accountId,
      inserted.map((j) => j.jobType)
    );

    return inserted;
  }

  async defineDeleteJobs(
    options: DeleteJobOptions
  ): Promise<BlueskyJobRecord[]> {
    console.log(
      "[BlueskyController] defineDeleteJobs -> start",
      this.accountId,
      {
        settings: options.settings,
        counts: options.counts,
      }
    );
    const db = this.requireDb();
    const scheduledAt = Date.now();
    const jobTypes: BlueskyJobType[] = ["verifyAuthorization"];
    const { settings, counts } = options;

    // Store the delete settings for use during job execution
    this.deleteSettings = settings;

    // Add delete jobs based on what the user selected and if there's data to delete
    if (settings.deletePosts && counts.posts > 0) {
      jobTypes.push("deletePosts");
    }

    if (settings.deleteReposts && counts.reposts > 0) {
      jobTypes.push("deleteReposts");
    }

    if (settings.deleteLikes && counts.likes > 0) {
      jobTypes.push("deleteLikes");
    }

    if (settings.deleteBookmarks && counts.bookmarks > 0) {
      jobTypes.push("deleteBookmarks");
    }

    if (settings.deleteChats && counts.messages > 0) {
      jobTypes.push("deleteMessages");
    }

    if (settings.deleteUnfollowEveryone && counts.follows > 0) {
      jobTypes.push("unfollowUsers");
    }

    const inserted: BlueskyJobRecord[] = [];

    for (const jobType of jobTypes) {
      const result = await db.runAsync(
        `INSERT INTO job (jobType, status, scheduledAt, progressJSON) VALUES (?, 'pending', ?, NULL);`,
        [jobType, scheduledAt]
      );
      const id = Number(result.lastInsertRowId);
      inserted.push({
        id,
        jobType,
        status: "pending",
        scheduledAt,
        startedAt: null,
        finishedAt: null,
        progress: undefined,
        error: null,
      });
    }

    console.log(
      "[BlueskyController] defineDeleteJobs -> inserted",
      this.accountId,
      inserted.map((j) => j.jobType)
    );

    return inserted;
  }

  async getPendingJobs(): Promise<BlueskyJobRecord[]> {
    const db = this.requireDb();
    const rows = await db.getAllAsync<JobRow>(
      `SELECT id, jobType, status, scheduledAt, startedAt, finishedAt, progressJSON, error
       FROM job
       WHERE status IN ('pending', 'running')
       ORDER BY scheduledAt ASC, id ASC;`
    );
    return (rows ?? []).map(mapJobRow);
  }

  async runJobs(params?: {
    jobs?: BlueskyJobRecord[];
    onUpdate?: (update: BlueskyJobRunUpdate) => void;
  }): Promise<void> {
    console.log("[BlueskyController] runJobs -> start", this.accountId);
    let jobs = params?.jobs ?? (await this.getPendingJobs());
    const emit = (update: Partial<BlueskyJobRunUpdate>) => {
      params?.onUpdate?.({
        jobs,
        activeJobId: update.activeJobId ?? null,
        speechText: update.speechText,
        progressMessage: update.progressMessage,
        progressPercent: update.progressPercent,
        unknownTotal: update.unknownTotal,
        previewPost: update.previewPost,
        previewData: update.previewData,
        progress: update.progress,
      });
    };

    emit({ activeJobId: null });

    for (const job of jobs) {
      await this.waitForPause();
      console.log(
        "[BlueskyController] runJobs -> job start",
        this.accountId,
        job.id,
        job.jobType
      );
      const startedAt = Date.now();
      await this.updateJobStatus(job.id, "running", startedAt, null, null);
      jobs = jobs.map((existing) =>
        existing.id === job.id
          ? { ...existing, status: "running", startedAt, error: null }
          : existing
      );
      emit({ activeJobId: job.id });

      const emitForJob: JobEmit = (update: Parameters<JobEmit>[0]) => {
        if (update.progress !== undefined) {
          jobs = jobs.map((existing) =>
            existing.id === job.id
              ? { ...existing, progress: update.progress }
              : existing
          );
        }

        emit({
          activeJobId: job.id,
          speechText: update.speechText,
          progressMessage: update.progressMessage,
          progressPercent: update.progressPercent,
          unknownTotal: update.unknownTotal,
          previewPost: update.previewPost,
          previewData: update.previewData,
          progress: update.progress,
        });
      };

      try {
        await runJob(
          this,
          { ...job, status: "running", startedAt },
          emitForJob
        );
        const finishedAt = Date.now();
        await this.updateJobStatus(
          job.id,
          "completed",
          job.startedAt ?? startedAt,
          finishedAt,
          null
        );
        jobs = jobs.map((existing) =>
          existing.id === job.id
            ? { ...existing, status: "completed", finishedAt, error: null }
            : existing
        );
        emit({ activeJobId: null });
        console.log(
          "[BlueskyController] runJobs -> job complete",
          this.accountId,
          job.id,
          job.jobType
        );
      } catch (err) {
        const finishedAt = Date.now();
        const message = err instanceof Error ? err.message : String(err);
        await this.updateJobStatus(
          job.id,
          "failed",
          job.startedAt ?? startedAt,
          finishedAt,
          message
        );
        jobs = jobs.map((existing) =>
          existing.id === job.id
            ? { ...existing, status: "failed", finishedAt, error: message }
            : existing
        );

        // Cancel remaining jobs
        const remaining = jobs.filter(
          (existing) => existing.status === "pending"
        );
        for (const pendingJob of remaining) {
          await this.updateJobStatus(
            pendingJob.id,
            "failed",
            pendingJob.startedAt ?? null,
            finishedAt,
            "Cancelled due to previous failure"
          );
        }
        jobs = jobs.map((existing) =>
          existing.status === "pending"
            ? {
                ...existing,
                status: "failed",
                finishedAt,
                error: existing.error ?? "Cancelled due to previous failure",
              }
            : existing
        );
        emit({
          activeJobId: null,
          progressMessage: message,
          speechText: "Automation failed",
        });
        console.warn(
          "[BlueskyController] runJobs -> job failed",
          this.accountId,
          job.id,
          job.jobType,
          message
        );
        break;
      }
    }

    console.log("[BlueskyController] runJobs -> done", this.accountId);
  }

  private async updateJobStatus(
    jobId: number,
    status: BlueskyJobStatus,
    startedAt: number | null,
    finishedAt: number | null,
    error: string | null
  ): Promise<void> {
    const db = this.requireDb();
    await db.runAsync(
      `UPDATE job
       SET status = ?,
           startedAt = COALESCE(startedAt, ?),
           finishedAt = ?,
           error = ?
       WHERE id = ?;`,
      [status, startedAt, finishedAt, error, jobId]
    );
  }

  private requireDb() {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    return this.db;
  }

  private requireAgent(): Agent {
    if (!this.agent) {
      throw new Error("Agent not initialized");
    }
    return this.agent;
  }

  // ==================== Save Operations ====================
  // These will be implemented in Phase 3

  /**
   * Index (save) the user's posts
   */
  async indexPosts(): Promise<void> {
    await this.indexer.indexPosts();
  }

  /**
   * Index (save) the user's likes
   */
  async indexLikes(): Promise<void> {
    await this.indexer.indexLikes();
  }

  /**
   * Index (save) the user's bookmarks
   */
  async indexBookmarks(): Promise<void> {
    await this.indexer.indexBookmarks();
  }

  /**
   * Index (save) the user's conversations
   */
  async indexChatConvos(): Promise<void> {
    await this.indexer.indexChatConvos();
  }

  /**
   * Index (save) messages in all conversations
   */
  async indexChatMessages(): Promise<void> {
    await this.indexer.indexChatMessages();
  }

  // ==================== Delete Operations ====================
  // These will be implemented in Phase 6

  // ==================== Delete Preview Calculations ====================

  /**
   * Calculate a preview of all items that will be deleted based on settings.
   * This should be called when the user clicks "Continue to Review" in the delete tab.
   */
  getDeletionPreview(settings: AccountDeleteSettings): DeletionPreview {
    const db = this.requireDb();
    const userDid = this.did;
    if (!userDid) {
      throw new Error("User DID not available");
    }
    return calculateDeletionPreview(db, userDid, settings);
  }

  /**
   * Calculate counts of items that will be deleted based on settings.
   * This is a lighter-weight version that just returns counts instead of full items.
   */
  getDeletionPreviewCounts(
    settings: AccountDeleteSettings
  ): DeletionPreviewCounts {
    const db = this.requireDb();
    const userDid = this.did;
    if (!userDid) {
      throw new Error("User DID not available");
    }
    return calculateDeletionPreviewCounts(db, userDid, settings);
  }

  /**
   * Get posts that will be deleted based on settings
   */
  getPostsToDelete(settings: AccountDeleteSettings) {
    const db = this.requireDb();
    const userDid = this.did;
    if (!userDid) {
      throw new Error("User DID not available");
    }
    return calculatePostsToDelete(db, userDid, settings);
  }

  /**
   * Get posts that will be deleted with full preview data for UI display
   */
  getPostsToDeleteWithPreview(
    settings: AccountDeleteSettings
  ): PostToDeletePreview[] {
    const db = this.requireDb();
    const userDid = this.did;
    if (!userDid) {
      throw new Error("User DID not available");
    }
    return calculatePostsToDeleteWithPreview(db, userDid, settings);
  }

  /**
   * Get posts for the deletion review UI (includes preserved posts).
   * This allows users to toggle preservation status in the review modal.
   */
  getPostsForDeletionReview(
    settings: AccountDeleteSettings
  ): PostToDeletePreview[] {
    const db = this.requireDb();
    const userDid = this.did;
    if (!userDid) {
      throw new Error("User DID not available");
    }
    return calculatePostsForDeletionReview(db, userDid, settings);
  }

  /**
   * Get reposts that will be deleted based on settings
   */
  getRepostsToDelete(settings: AccountDeleteSettings) {
    const db = this.requireDb();
    const userDid = this.did;
    if (!userDid) {
      throw new Error("User DID not available");
    }
    return calculateRepostsToDelete(db, userDid, settings);
  }

  /**
   * Get likes that will be deleted based on settings
   */
  getLikesToDelete(settings: AccountDeleteSettings) {
    const db = this.requireDb();
    const userDid = this.did;
    if (!userDid) {
      throw new Error("User DID not available");
    }
    return calculateLikesToDelete(db, userDid, settings);
  }

  /**
   * Get messages that will be deleted based on settings
   */
  getMessagesToDelete(settings: AccountDeleteSettings) {
    const db = this.requireDb();
    const userDid = this.did;
    if (!userDid) {
      throw new Error("User DID not available");
    }
    return calculateMessagesToDelete(db, userDid, settings);
  }

  /**
   * Get bookmarks that will be deleted based on settings
   */
  getBookmarksToDelete(settings: AccountDeleteSettings) {
    const db = this.requireDb();
    return calculateBookmarksToDelete(db, settings);
  }

  /**
   * Get follows that will be unfollowed based on settings
   */
  getFollowsToUnfollow(settings: AccountDeleteSettings) {
    const db = this.requireDb();
    return calculateFollowsToUnfollow(db, settings);
  }

  // ==================== Delete Execution ====================

  /**
   * Get the current delete settings stored on this controller
   */
  getDeleteSettings(): AccountDeleteSettings | null {
    return this.deleteSettings;
  }

  /**
   * Set the delete settings on this controller
   */
  setDeleteSettings(settings: AccountDeleteSettings): void {
    this.deleteSettings = settings;
  }

  /**
   * Delete a single post by its AT-URI
   */
  async deletePost(postUri: string): Promise<void> {
    const agent = this.requireAgent();
    const db = this.requireDb();
    const did = this.did;
    if (!did) throw new Error("DID not available");

    // Delete from Bluesky
    await this.makeApiRequest(() =>
      agent.api.com.atproto.repo.deleteRecord({
        repo: did,
        collection: "app.bsky.feed.post",
        rkey: postUri.split("/").pop() ?? "",
      })
    );

    // Mark as deleted in local DB
    db.runSync(`UPDATE post SET deletedPostAt = ? WHERE uri = ?;`, [
      new Date().toISOString(),
      postUri,
    ]);
  }

  /**
   * Delete a single repost by its AT-URI
   */
  async deleteRepost(repostUri: string): Promise<void> {
    const agent = this.requireAgent();
    const db = this.requireDb();
    const did = this.did;
    if (!did) throw new Error("DID not available");

    // Delete from Bluesky
    await this.makeApiRequest(() =>
      agent.api.com.atproto.repo.deleteRecord({
        repo: did,
        collection: "app.bsky.feed.repost",
        rkey: repostUri.split("/").pop() ?? "",
      })
    );

    // Mark as deleted in local DB
    db.runSync(`UPDATE post SET deletedRepostAt = ? WHERE repostUri = ?;`, [
      new Date().toISOString(),
      repostUri,
    ]);
  }

  /**
   * Delete a single like by its AT-URI
   * @param likeUri - The AT-URI of the like record (at://did/app.bsky.feed.like/rkey)
   * @param postUri - The AT-URI of the liked post (for updating local DB)
   */
  async deleteLike(likeUri: string, postUri: string): Promise<void> {
    const agent = this.requireAgent();
    const db = this.requireDb();
    const did = this.did;
    if (!did) throw new Error("DID not available");

    // Delete from Bluesky
    await this.makeApiRequest(() =>
      agent.api.com.atproto.repo.deleteRecord({
        repo: did,
        collection: "app.bsky.feed.like",
        rkey: likeUri.split("/").pop() ?? "",
      })
    );

    // Mark as deleted in local DB (update the post record's deletedLikeAt)
    db.runSync(`UPDATE post SET deletedLikeAt = ? WHERE uri = ?;`, [
      Date.now(),
      postUri,
    ]);
  }

  /**
   * Delete a single bookmark by its ID
   */
  async deleteBookmark(bookmarkId: number): Promise<void> {
    const agent = this.requireAgent();
    const db = this.requireDb();

    // Get the subject URI (the URI of the bookmarked post)
    const bookmark = db.getFirstSync<{ subjectUri: string }>(
      `SELECT subjectUri FROM bookmark WHERE id = ?;`,
      [bookmarkId]
    );

    if (bookmark?.subjectUri) {
      // Delete from Bluesky using the bookmark API
      // Note: This API returns { success, headers } instead of { data, headers }
      // so we call it directly instead of using makeApiRequest
      await agent.api.app.bsky.bookmark.deleteBookmark({
        uri: bookmark.subjectUri,
      });
    }

    // Mark as deleted in local DB
    db.runSync(`UPDATE bookmark SET deletedAt = ? WHERE id = ?;`, [
      new Date().toISOString(),
      bookmarkId,
    ]);
  }

  /**
   * Delete a single message by its ID
   */
  async deleteMessage(convoId: string, messageId: string): Promise<void> {
    const agent = this.requireAgent();
    const db = this.requireDb();

    // Headers required for the Bluesky Chat DM service proxy
    const DM_SERVICE_HEADERS = {
      "atproto-proxy": "did:web:api.bsky.chat#bsky_chat",
    };

    // Delete from Bluesky using chat API with proper proxy headers
    await this.makeApiRequest(() =>
      agent.api.chat.bsky.convo.deleteMessageForSelf(
        {
          convoId,
          messageId,
        },
        { encoding: "application/json", headers: DM_SERVICE_HEADERS }
      )
    );

    // Mark as deleted in local DB
    db.runSync(`UPDATE message SET deletedAt = ? WHERE messageId = ?;`, [
      new Date().toISOString(),
      messageId,
    ]);
  }

  /**
   * Unfollow a single user by the follow record AT-URI
   */
  async unfollowUser(followUri: string): Promise<void> {
    const agent = this.requireAgent();
    const db = this.requireDb();
    const did = this.did;
    if (!did) throw new Error("DID not available");

    // Delete the follow record from Bluesky
    await this.makeApiRequest(() =>
      agent.api.com.atproto.repo.deleteRecord({
        repo: did,
        collection: "app.bsky.graph.follow",
        rkey: followUri.split("/").pop() ?? "",
      })
    );

    // Mark as unfollowed in local DB
    db.runSync(`UPDATE follow SET unfollowedAt = ? WHERE uri = ?;`, [
      new Date().toISOString(),
      followUri,
    ]);
  }

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

  // ==================== Post Preservation ====================

  /**
   * Set the preserve flag for a post.
   * @param postUri The AT-URI of the post
   * @param preserve Whether to preserve the post from deletion
   * @returns True if the post was updated, false if not found
   */
  setPostPreserve(postUri: string, preserve: boolean): boolean {
    const db = this.requireDb();
    const result = db.runSync(`UPDATE post SET preserve = ? WHERE uri = ?;`, [
      preserve ? 1 : 0,
      postUri,
    ]);
    return result.changes > 0;
  }

  /**
   * Toggle the preserve flag for a post.
   * @param postUri The AT-URI of the post
   * @returns The new preserve value, or null if post not found
   */
  togglePostPreserve(postUri: string): boolean | null {
    const db = this.requireDb();
    const row = db.getFirstSync<{ preserve: number }>(
      `SELECT preserve FROM post WHERE uri = ?;`,
      [postUri]
    );
    if (!row) {
      return null;
    }
    const newValue = row.preserve === 1 ? 0 : 1;
    db.runSync(`UPDATE post SET preserve = ? WHERE uri = ?;`, [
      newValue,
      postUri,
    ]);
    return newValue === 1;
  }

  /**
   * Get the preserve flag for a post.
   * @param postUri The AT-URI of the post
   * @returns The preserve value, or null if post not found
   */
  getPostPreserve(postUri: string): boolean | null {
    const db = this.requireDb();
    const row = db.getFirstSync<{ preserve: number }>(
      `SELECT preserve FROM post WHERE uri = ?;`,
      [postUri]
    );
    if (!row) {
      return null;
    }
    return row.preserve === 1;
  }

  // ==================== Media Operations ====================
  // These will be implemented in Phase 4

  /**
   * Download media blob and return local file path
   */
  async downloadMedia(blobCid: string, did: string): Promise<string> {
    if (!blobCid || !did) {
      throw new Error("Invalid blobCid or did");
    }

    return this.downloadToAccountMedia({
      did,
      filename: blobCid,
      url: `https://cdn.bsky.app/blob/${encodeURIComponent(did)}/${encodeURIComponent(blobCid)}`,
    });
  }

  async downloadMediaFromUrl(url: string, did: string): Promise<string> {
    if (!url || !did) {
      throw new Error("Invalid url or did");
    }

    return this.downloadToAccountMedia({
      did,
      filename: url,
      url,
    });
  }

  private async downloadToAccountMedia(options: {
    did: string;
    filename: string;
    url: string;
  }): Promise<string> {
    const { did, filename, url } = options;
    if (!this.agent) {
      throw new Error("Agent not initialized");
    }

    await this.ensureAccountDirectory();
    const accountPaths = buildAccountPaths(
      this.getAccountType(),
      this.getAccountUUID()
    );
    const safeDid = encodeURIComponent(did);
    const safeName = encodeURIComponent(filename);
    const mediaDir = new Directory(accountPaths.mediaDir, safeDid);

    if (!mediaDir.exists) {
      mediaDir.create({ intermediates: true, idempotent: true });
    }

    const targetFile = new File(mediaDir, safeName);
    if (targetFile.exists) {
      return targetFile.uri;
    }

    const downloaded = await File.downloadFileAsync(url, targetFile);
    return downloaded.uri;
  }

  async deleteAccountStorage(): Promise<void> {
    await this.cleanup();
    try {
      const accountPaths = buildAccountPaths(
        this.getAccountType(),
        this.getAccountUUID()
      );

      const deleteIfExists = (path: string) => {
        const info = Paths.info(path);
        if (!info.exists) return;
        if (info.isDirectory) {
          new Directory(path).delete();
        } else {
          new File(path).delete();
        }
      };

      // Remove the canonical account folder (db + media)
      deleteIfExists(accountPaths.accountDir);

      // Clean up legacy paths that may still exist from earlier builds
      deleteIfExists(
        `${accountPaths.base}bluesky-accounts/${this.getAccountUUID()}`
      );
      deleteIfExists(
        `${accountPaths.base}SQLite/bluesky-accounts/${this.getAccountUUID()}`
      );
      deleteIfExists(
        `${accountPaths.base}SQLite/accounts/${this.getAccountType()}-${this.getAccountUUID()}`
      );
    } catch (err) {
      console.warn("Failed to delete account storage", err);
      throw err instanceof Error
        ? err
        : new Error("Unable to delete account storage");
    }
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

import {
  Agent,
  type AppBskyActorDefs,
  ChatBskyConvoDefs,
} from "@atproto/api";
import type { OAuthSession } from "@atproto/oauth-client";
import { Directory, File, Paths } from "expo-file-system";
import type { SQLiteDatabase } from "expo-sqlite";

import { getDatabase } from "@/database";
import { resolveBlobDownloadUrl } from "./bluesky/blob-url";
import {
    applyAccountMigrations,
    blueskyAccountMigrations,
} from "@/database/account-db";
import type { AccountDeleteSettings } from "@/database/delete-settings";
import {
  createBlueskyArchiveExportEnvironment,
  runBlueskyArchiveExport,
  type BlueskyArchiveExportProgress,
  type BlueskyArchiveExportResult,
  type PortableSettings,
} from "@/services/archive-export";
import { restoreBlueskyOAuthSession } from "@/services/bluesky-oauth";
import {
    BaseAccountController,
    CancelledError,
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
    type SaveAndDeleteJobOptions,
    type SaveJobOptions,
} from "./bluesky/job-types";
import { upsertProfileRow } from "./bluesky/post-persistence";
import { BlueskyRateLimiter, type ApiRequestFn } from "./bluesky/rate-limiter";
import type {
    BlueskyDatabaseStats,
    BlueskyProgress,
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
    RateLimitInfo
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
    RepostToDelete
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
  private isRunJobsActive = false;

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
      downloadMedia: (blobCid: string, did: string) =>
        this.downloadMedia(blobCid, did),
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
    await this.writeMetadata();
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
    }>(
      `SELECT b.did, b.handle
       FROM account a
       INNER JOIN bsky_account b ON b.id = a.bskyAccountID
       WHERE a.id = ?;`,
      [this.accountId],
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
      this.handle,
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
   * Get the user's profile data from the local database (includes avatar URL)
   */
  getUserProfileData(): {
    did: string;
    handle: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  } | null {
    if (!this.db || !this.did) {
      return null;
    }

    const profile = this.db.getFirstSync<{
      displayName: string | null;
      avatarUrl: string | null;
    }>(`SELECT displayName, avatarUrl FROM profile WHERE did = ?;`, [this.did]);

    return {
      did: this.did,
      handle: this.handle ?? "",
      displayName: profile?.displayName,
      avatarUrl: profile?.avatarUrl,
    };
  }

  /**
   * Get profiles by DIDs from the local database
   */
  getProfilesByDids(dids: string[]): Map<
    string,
    {
      did: string;
      handle: string;
      displayName?: string | null;
      avatarUrl?: string | null;
    }
  > {
    const result = new Map<
      string,
      {
        did: string;
        handle: string;
        displayName?: string | null;
        avatarUrl?: string | null;
      }
    >();

    if (!this.db || dids.length === 0) {
      return result;
    }

    const placeholders = dids.map(() => "?").join(",");
    const profiles = this.db.getAllSync<{
      did: string;
      handle: string;
      displayName: string | null;
      avatarUrl: string | null;
    }>(
      `SELECT did, handle, displayName, avatarUrl FROM profile WHERE did IN (${placeholders});`,
      dids,
    );

    for (const profile of profiles) {
      result.set(profile.did, {
        did: profile.did,
        handle: profile.handle,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
      });
    }

    return result;
  }

  /**
   * Check if the agent is initialized
   */
  isAgentReady(): boolean {
    return this.agent !== null;
  }

  /**
   * Drop the in-memory agent and the identity it was built from.
   *
   * The agent holds one Bluesky connection for the life of the controller, so
   * anything that invalidates or replaces that connection — disconnecting,
   * reauthenticating — has to reset it. Otherwise the next request goes out
   * over the old session, and the refresh that atproto attempts on the
   * resulting 401 deletes the stored connection, including a newer one that
   * shares the same key. Unlike cleanup(), the controller stays usable: the
   * next initAgent() rebuilds from whatever connection is stored now.
   */
  resetAgent(): void {
    console.log("[BlueskyController] resetAgent", this.accountId);
    this.agent = null;
    this.did = null;
    this.handle = null;
  }

  /**
   * Refresh the session after re-authentication
   */
  async refreshSession(newSession: OAuthSession): Promise<void> {
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
   * Get a profile from the API. Defaults to the logged-in user's own profile
   * when no actor is given.
   */
  async getProfile(
    actor?: string,
  ): Promise<AppBskyActorDefs.ProfileViewDetailed | null> {
    if (!this.agent || !this.did) {
      return null;
    }

    const target = actor ?? this.did;
    return this.rateLimiter.makeApiRequest(() =>
      this.agent!.getProfile({ actor: target }),
    );
  }

  /**
   * Write down what Bluesky says about this account's own identity now.
   *
   * Browse renders a record's author from the account's `profile` table rather
   * than from the account row, so the two can disagree: an account restored
   * from a Cyd Bluesky archive has the profile the archive carried, which has
   * no avatar in it at all and may have no name. Saving posts refreshes it
   * eventually, as a side effect of saving their authors — but signing in is
   * the first moment Cyd has anything fresher, and somebody who browses before
   * saving should see what Cyd knows rather than what it used to know.
   */
  async refreshOwnProfile(): Promise<void> {
    if (!this.db) {
      return;
    }
    const profile = await this.getProfile();
    if (!profile) {
      return;
    }
    await upsertProfileRow(this.db, profile);
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

  async defineSaveJobs(options: SaveJobOptions): Promise<BlueskyJobRecord[]> {
    console.log("[BlueskyController] defineSaveJobs -> start", this.accountId, {
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
        [jobType, scheduledAt],
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
      "[BlueskyController] defineSaveJobs -> inserted",
      this.accountId,
      inserted.map((j) => j.jobType),
    );

    return inserted;
  }

  async defineDeleteJobs(
    options: DeleteJobOptions,
  ): Promise<BlueskyJobRecord[]> {
    console.log(
      "[BlueskyController] defineDeleteJobs -> start",
      this.accountId,
      {
        settings: options.settings,
        counts: options.counts,
      },
    );
    const db = this.requireDb();
    const scheduledAt = Date.now();
    const jobTypes: BlueskyJobType[] = ["verifyAuthorization"];
    const { settings, counts } = options;

    // Store the delete settings for use during job execution
    this.deleteSettings = settings;

    // Add delete jobs based on what the user selected and if there's data to delete
    if (settings.deletePosts && counts && counts.posts > 0) {
      jobTypes.push("deletePosts");
    }

    if (settings.deleteReposts && counts && counts.reposts > 0) {
      jobTypes.push("deleteReposts");
    }

    if (settings.deleteLikes && counts && counts.likes > 0) {
      jobTypes.push("deleteLikes");
    }

    if (settings.deleteBookmarks && counts && counts.bookmarks > 0) {
      jobTypes.push("deleteBookmarks");
    }

    // Schedule the delete-messages job whenever chat deletion is enabled, even
    // when there are no messages to delete: the job also cleans up (leaves)
    // empty conversations, which have no rows in the message table.
    if (settings.deleteChats) {
      jobTypes.push("deleteMessages");
    }

    // Note: For "Unfollow everyone", we don't check counts.follows because
    // we don't save the following list locally. The job will fetch follows
    // from the API at runtime.
    if (settings.deleteUnfollowEveryone) {
      jobTypes.push("unfollowUsers");
    }

    const inserted: BlueskyJobRecord[] = [];

    for (const jobType of jobTypes) {
      const result = await db.runAsync(
        `INSERT INTO job (jobType, status, scheduledAt, progressJSON) VALUES (?, 'pending', ?, NULL);`,
        [jobType, scheduledAt],
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
      inserted.map((j) => j.jobType),
    );

    return inserted;
  }

  /**
   * Define both save and delete jobs to be run in sequence.
   * This is used for scheduled automation that saves data first, then deletes.
   * Only one verifyAuthorization job is added at the start.
   */
  async defineSaveAndDeleteJobs(
    options: SaveAndDeleteJobOptions,
  ): Promise<BlueskyJobRecord[]> {
    console.log(
      "[BlueskyController] defineSaveAndDeleteJobs -> start",
      this.accountId,
      {
        saveOptions: options.saveOptions,
        deleteSettings: options.deleteOptions.settings,
        deleteCounts: options.deleteOptions.counts,
      },
    );
    const db = this.requireDb();
    const scheduledAt = Date.now();
    const jobTypes: BlueskyJobType[] = ["verifyAuthorization"];

    // Add save jobs first
    const { saveOptions } = options;
    if (saveOptions.posts) {
      jobTypes.push("savePosts");
    }
    if (saveOptions.likes) {
      jobTypes.push("saveLikes");
    }
    if (saveOptions.bookmarks) {
      jobTypes.push("saveBookmarks");
    }
    if (saveOptions.chat) {
      jobTypes.push("saveChatConvos");
      jobTypes.push("saveChatMessages");
    }

    // Then add delete jobs
    const { settings } = options.deleteOptions;

    // Store the delete settings for use during job execution
    this.deleteSettings = settings;

    // Add delete jobs even when counts are 0, so the finished modal shows them
    if (settings.deletePosts) {
      jobTypes.push("deletePosts");
    }
    if (settings.deleteReposts) {
      jobTypes.push("deleteReposts");
    }
    if (settings.deleteLikes) {
      jobTypes.push("deleteLikes");
    }
    if (settings.deleteBookmarks) {
      jobTypes.push("deleteBookmarks");
    }
    if (settings.deleteChats) {
      jobTypes.push("deleteMessages");
    }
    if (settings.deleteUnfollowEveryone) {
      jobTypes.push("unfollowUsers");
    }

    const inserted: BlueskyJobRecord[] = [];

    for (const jobType of jobTypes) {
      const result = await db.runAsync(
        `INSERT INTO job (jobType, status, scheduledAt, progressJSON) VALUES (?, 'pending', ?, NULL);`,
        [jobType, scheduledAt],
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
      "[BlueskyController] defineSaveAndDeleteJobs -> inserted",
      this.accountId,
      inserted.map((j) => j.jobType),
    );

    return inserted;
  }

  async getPendingJobs(): Promise<BlueskyJobRecord[]> {
    const db = this.requireDb();
    const rows = await db.getAllAsync<JobRow>(
      `SELECT id, jobType, status, scheduledAt, startedAt, finishedAt, progressJSON, error
       FROM job
       WHERE status IN ('pending', 'running')
       ORDER BY scheduledAt ASC, id ASC;`,
    );
    return (rows ?? []).map(mapJobRow);
  }

  async runJobs(params?: {
    jobs?: BlueskyJobRecord[];
    onUpdate?: (update: BlueskyJobRunUpdate) => void;
  }): Promise<void> {
    if (this.isRunJobsActive) {
      throw new Error("Automation already running for this account.");
    }

    this.isRunJobsActive = true;
    this.resetCancel();

    try {
      console.log("[BlueskyController] runJobs -> start", this.accountId);
      let jobs = params?.jobs ?? (await this.getPendingJobs());
      const emit = (update: Partial<BlueskyJobRunUpdate>) => {
        params?.onUpdate?.({
          jobs,
          activeJobId: update.activeJobId ?? null,
          currentConversationLabel: update.currentConversationLabel ?? null,
          speechText: update.speechText,
          progressMessage: update.progressMessage,
          progressPercent: update.progressPercent,
          unknownTotal: update.unknownTotal,
          previewPost: update.previewPost,
          previewData: update.previewData,
          progress: update.progress,
          rateLimitResetAt: update.rateLimitResetAt,
        });
      };

      emit({ activeJobId: null });

      for (const job of jobs) {
        await this.waitForPause();
        console.log(
          "[BlueskyController] runJobs -> job start",
          this.accountId,
          job.id,
          job.jobType,
        );
        const startedAt = Date.now();
        jobs = jobs.map((existing) =>
          existing.id === job.id
            ? { ...existing, status: "running", startedAt, error: null }
            : existing,
        );
        try {
          await this.updateJobStatus(job.id, "running", startedAt, null, null);
        } catch (statusErr) {
          console.warn(
            "[BlueskyController] runJobs -> failed to persist running status",
            this.accountId,
            job.id,
            statusErr,
          );
        }
        emit({ activeJobId: job.id });

        const emitForJob: JobEmit = (update: Parameters<JobEmit>[0]) => {
          if (update.progress !== undefined) {
            jobs = jobs.map((existing) =>
              existing.id === job.id
                ? { ...existing, progress: update.progress }
                : existing,
            );
          }

          emit({
            activeJobId: job.id,
            currentConversationLabel: update.currentConversationLabel,
            speechText: update.speechText,
            progressMessage: update.progressMessage,
            progressPercent: update.progressPercent,
            unknownTotal: update.unknownTotal,
            previewPost: update.previewPost,
            previewData: update.previewData,
            progress: update.progress,
            rateLimitResetAt: update.rateLimitResetAt,
          });
        };

        this.rateLimiter.setJobEmit(emitForJob);

        try {
          await runJob(
            this,
            { ...job, status: "running", startedAt },
            emitForJob,
          );
          this.rateLimiter.clearJobEmit();
          const finishedAt = Date.now();
          jobs = jobs.map((existing) =>
            existing.id === job.id
              ? { ...existing, status: "completed", finishedAt, error: null }
              : existing,
          );
          try {
            await this.updateJobStatus(
              job.id,
              "completed",
              job.startedAt ?? startedAt,
              finishedAt,
              null,
            );
          } catch (statusErr) {
            console.warn(
              "[BlueskyController] runJobs -> failed to persist completed status",
              this.accountId,
              job.id,
              statusErr,
            );
          }
          emit({ activeJobId: null });
          console.log(
            "[BlueskyController] runJobs -> job complete",
            this.accountId,
            job.id,
            job.jobType,
          );
        } catch (err) {
          this.rateLimiter.clearJobEmit();
          const finishedAt = Date.now();
          const message = err instanceof Error ? err.message : String(err);
          const pendingJobIds = jobs
            .filter(
              (existing) =>
                existing.id !== job.id && existing.status === "pending",
            )
            .map((pendingJob) => pendingJob.id);

          jobs = jobs.map((existing) =>
            existing.id === job.id
              ? { ...existing, status: "failed", finishedAt, error: message }
              : existing.status === "pending"
                ? {
                    ...existing,
                    status: "failed",
                    finishedAt,
                    error:
                      existing.error ?? "Cancelled due to previous failure",
                  }
                : existing,
          );

          try {
            await this.updateJobStatus(
              job.id,
              "failed",
              job.startedAt ?? startedAt,
              finishedAt,
              message,
            );
          } catch (statusErr) {
            console.warn(
              "[BlueskyController] runJobs -> failed to persist failed status",
              this.accountId,
              job.id,
              statusErr,
            );
          }

          for (const pendingJobId of pendingJobIds) {
            try {
              await this.updateJobStatus(
                pendingJobId,
                "failed",
                null,
                finishedAt,
                "Cancelled due to previous failure",
              );
            } catch (pendingStatusErr) {
              console.warn(
                "[BlueskyController] runJobs -> failed to persist cancelled status",
                this.accountId,
                pendingJobId,
                pendingStatusErr,
              );
            }
          }

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
            message,
          );
          break;
        }
      }

      console.log("[BlueskyController] runJobs -> done", this.accountId);
    } catch (err) {
      // CancelledError is expected when the user stops the automation
      if (err instanceof CancelledError) {
        console.log("[BlueskyController] runJobs -> cancelled", this.accountId);
      } else {
        throw err;
      }
    } finally {
      this.isRunJobsActive = false;
    }
  }

  private async updateJobStatus(
    jobId: number,
    status: BlueskyJobStatus,
    startedAt: number | null,
    finishedAt: number | null,
    error: string | null,
  ): Promise<void> {
    const db = this.requireDb();
    await db.runAsync(
      `UPDATE job
       SET status = ?,
           startedAt = COALESCE(startedAt, ?),
           finishedAt = ?,
           error = ?
       WHERE id = ?;`,
      [status, startedAt, finishedAt, error, jobId],
    );
  }

  private requireDb() {
    if (this.isDisposed) {
      throw new Error("Controller has been disposed");
    }
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    return this.db;
  }

  /**
   * Get the database instance (throws if not initialized)
   */
  getDB(): SQLiteDatabase {
    return this.requireDb();
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
    settings: AccountDeleteSettings,
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
    settings: AccountDeleteSettings,
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
    settings: AccountDeleteSettings,
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
      }),
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
      }),
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
      }),
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
      [bookmarkId],
    );

    if (bookmark?.subjectUri) {
      // The bookmark API returns { success, headers } instead of { data, headers },
      // so we reshape it to work with makeApiRequest
      await this.makeApiRequest(async () => {
        const result = await agent.api.app.bsky.bookmark.deleteBookmark({
          uri: bookmark.subjectUri,
        });
        return { data: result.success, headers: result.headers };
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
        { encoding: "application/json", headers: DM_SERVICE_HEADERS },
      ),
    );

    // Mark as deleted in local DB (store as epoch milliseconds)
    db.runSync(`UPDATE message SET deletedAt = ? WHERE messageId = ?;`, [
      Date.now(),
      messageId,
    ]);
  }

  /**
   * Get the convoIds of conversations that are candidates for cleanup: those
   * that haven't been left yet and have no remaining un-deleted messages locally.
   * This includes both empty conversations (never had saved messages) and
   * conversations we just emptied, while skipping conversations that still hold
   * un-deleted messages (e.g. when a date filter kept some).
   */
  getConversationIdsToCleanup(): string[] {
    const db = this.requireDb();
    const rows = db.getAllSync<{ convoId: string }>(
      `SELECT c.convoId FROM conversation c
       WHERE c.leftAt IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM message m
           WHERE m.convoId = c.convoId AND m.deletedAt IS NULL
         );`,
    );
    return rows.map((r) => r.convoId);
  }

  /**
   * Get the count of real messages remaining in a conversation from the
   * Bluesky API. Only counts messageView entries — placeholders such as
   * deletedMessageView (returned for messages the user deleted for themselves)
   * and systemMessageView don't count, so a conversation whose messages have
   * all been deleted is correctly reported as empty and can be left.
   */
  async getConversationMessageCount(convoId: string): Promise<number> {
    const agent = this.requireAgent();

    const DM_SERVICE_HEADERS = {
      "atproto-proxy": "did:web:api.bsky.chat#bsky_chat",
    };

    const response = await this.makeApiRequest(() =>
      agent.chat.bsky.convo.getMessages(
        {
          convoId,
          limit: 100,
        },
        { headers: DM_SERVICE_HEADERS },
      ),
    );

    return (response.messages ?? []).filter((message) =>
      ChatBskyConvoDefs.isMessageView(message),
    ).length;
  }

  /**
   * Leave a conversation (removes it from the user's view)
   */
  async leaveConversation(convoId: string): Promise<void> {
    const agent = this.requireAgent();
    const db = this.requireDb();

    const DM_SERVICE_HEADERS = {
      "atproto-proxy": "did:web:api.bsky.chat#bsky_chat",
    };

    await this.makeApiRequest(() =>
      agent.api.chat.bsky.convo.leaveConvo(
        { convoId },
        { encoding: "application/json", headers: DM_SERVICE_HEADERS },
      ),
    );

    // Mark conversation as left in local DB
    db.runSync(`UPDATE conversation SET leftAt = ? WHERE convoId = ?;`, [
      Date.now(),
      convoId,
    ]);
  }

  /**
   * Fetch all follows from the Bluesky API (paginated).
   * Returns an array of follow records with URI and subject info.
   * Used for unfollowing everyone since we don't save follows locally.
   */
  async fetchFollowsFromApi(onProgress?: (current: number) => void): Promise<
    {
      uri: string;
      subjectDid: string;
      handle: string;
      displayName: string | null;
    }[]
  > {
    const agent = this.requireAgent();
    const did = this.did;
    if (!did) throw new Error("DID not available");

    const follows: {
      uri: string;
      subjectDid: string;
      handle: string;
      displayName: string | null;
    }[] = [];

    let cursor: string | undefined;
    const pageSize = 100;

    while (true) {
      const response = await this.makeApiRequest(() =>
        agent.app.bsky.graph.getFollows({
          actor: did,
          cursor,
          limit: pageSize,
        }),
      );

      const pageFollows = response.follows ?? [];

      for (const profile of pageFollows) {
        // We need to get the follow URI by listing the follow records
        // The getFollows API only returns ProfileView without the follow record URI
        // So we'll need to look up the follow record for each profile
        follows.push({
          uri: "", // Will be filled in below
          subjectDid: profile.did,
          handle: profile.handle,
          displayName: profile.displayName ?? null,
        });
      }

      if (onProgress) {
        onProgress(follows.length);
      }

      if (pageFollows.length === 0 || !response.cursor) {
        break;
      }

      cursor = response.cursor;
    }

    // Now we need to get the actual follow record URIs by listing our follow records
    // This is needed because unfollowing requires the follow record URI
    const followsBySubject = new Map(follows.map((f) => [f.subjectDid, f]));

    cursor = undefined;
    while (true) {
      const response = await this.makeApiRequest(() =>
        agent.api.com.atproto.repo.listRecords({
          repo: did,
          collection: "app.bsky.graph.follow",
          cursor,
          limit: pageSize,
        }),
      );

      const records = response.records ?? [];

      for (const record of records) {
        const subjectDid = (record.value as { subject?: string })?.subject;
        if (subjectDid && followsBySubject.has(subjectDid)) {
          const follow = followsBySubject.get(subjectDid);
          if (follow) {
            follow.uri = record.uri;
          }
        }
      }

      if (records.length === 0 || !response.cursor) {
        break;
      }

      cursor = response.cursor;
    }

    // Filter out any follows where we couldn't get the URI (shouldn't happen normally)
    return follows.filter((f) => f.uri !== "");
  }

  /**
   * Follow a user by their DID
   * @param subjectDid - The DID of the user to follow
   */
  async followUser(subjectDid: string): Promise<void> {
    const agent = this.requireAgent();
    const did = this.did;
    if (!did) throw new Error("DID not available");

    await this.makeApiRequest(() =>
      agent.api.com.atproto.repo.createRecord({
        repo: did,
        collection: "app.bsky.graph.follow",
        record: {
          $type: "app.bsky.graph.follow",
          subject: subjectDid,
          createdAt: new Date().toISOString(),
        },
      }),
    );
  }

  /**
   * Unfollow a single user by the follow record AT-URI
   * @param followUri - The AT-URI of the follow record
   * @param subjectInfo - Optional info about the followed user (for tracking in local DB)
   */
  async unfollowUser(
    followUri: string,
    subjectInfo?: {
      subjectDid: string;
      handle: string;
      displayName: string | null;
    },
  ): Promise<void> {
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
      }),
    );

    const now = new Date().toISOString();
    const nowTs = Date.now();

    // If we have subject info, ensure the follow record exists in the database
    // This handles the case where follows were fetched from API but not saved locally
    if (subjectInfo) {
      // First, ensure the profile exists (required for foreign key constraint)
      db.runSync(
        `INSERT OR IGNORE INTO profile (did, handle, displayName, savedAt, updatedAt)
         VALUES (?, ?, ?, ?, ?);`,
        [
          subjectInfo.subjectDid,
          subjectInfo.handle,
          subjectInfo.displayName,
          nowTs,
          nowTs,
        ],
      );

      // Now insert the follow record (cid is required but we use empty string as placeholder)
      db.runSync(
        `INSERT OR IGNORE INTO follow (uri, cid, subjectDid, handle, displayName, createdAt, savedAt, unfollowedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          followUri,
          "", // cid placeholder - we don't have it when fetching from API
          subjectInfo.subjectDid,
          subjectInfo.handle,
          subjectInfo.displayName,
          now,
          nowTs,
          nowTs, // Mark as unfollowed immediately since we just unfollowed
        ],
      );
    }

    // Mark as unfollowed in local DB (for existing records or fallback)
    db.runSync(`UPDATE follow SET unfollowedAt = ? WHERE uri = ?;`, [
      nowTs,
      followUri,
    ]);
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
      [postUri],
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
      [postUri],
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

    const url = await resolveBlobDownloadUrl(did, blobCid);
    return this.downloadToAccountMedia({
      filename: blobCid,
      url,
    });
  }

  async downloadMediaFromUrl(url: string, did: string): Promise<string> {
    if (!url || !did) {
      throw new Error("Invalid url or did");
    }

    return this.downloadToAccountMedia({
      filename: url,
      url,
    });
  }

  private async downloadToAccountMedia(options: {
    filename: string;
    url: string;
  }): Promise<string> {
    const { filename, url } = options;
    if (!this.agent) {
      throw new Error("Agent not initialized");
    }

    await this.ensureAccountDirectory();
    const accountPaths = buildAccountPaths(
      this.getAccountType(),
      this.getAccountUUID(),
    );
    const safeName = encodeURIComponent(filename);
    const mediaDir = new Directory(accountPaths.mediaDir);

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

  // ==================== Cyd Bluesky Archive Export ====================

  /**
   * Write this account's Bluesky saved data out as a Cyd Bluesky archive.
   *
   * Needs no Bluesky connection: export reads only what Cyd already has, so it
   * works while disconnected, offline, and without premium (ADR 0015).
   *
   * Reusing an `exportId` resumes that export rather than starting another,
   * which is how an export the operating system killed carries on from what it
   * had already staged (ADR 0006).
   *
   * What calls this is "Export Bluesky archive" in the app-wide menu, which is
   * offered because the conformance matrix passes in both directions (#100,
   * ADR 0004) rather than because somebody decided the writer looked ready.
   */
  async exportBlueskyArchive(options: {
    exportId: string;
    portableSettings: PortableSettings;
    shouldCancel?: () => boolean;
    onProgress?: (progress: BlueskyArchiveExportProgress) => void;
  }): Promise<BlueskyArchiveExportResult> {
    const identity = await this.resolveExportIdentity();
    const accountDatabase = this.requireDb();

    // Only undo the pause this export caused. Somebody who paused their own
    // save job before exporting should still be paused afterwards.
    let pausedForExport = false;

    const environment = createBlueskyArchiveExportEnvironment({
      accountDatabase,
      pauseAccountWork: () => {
        pausedForExport = !this.isPaused();
        if (pausedForExport) {
          this.pause();
        }
      },
      resumeAccountWork: () => {
        if (pausedForExport) {
          this.resume();
          pausedForExport = false;
        }
      },
    });

    return runBlueskyArchiveExport(environment, {
      exportId: options.exportId,
      accountUuid: this.getAccountUUID(),
      accountDid: identity.did,
      accountHandle: identity.handle,
      portableSettings: options.portableSettings,
      shouldCancel: options.shouldCancel,
      onProgress: options.onProgress,
    });
  }

  /**
   * The identity an archive names, read without needing an agent.
   */
  private async resolveExportIdentity(): Promise<{
    did: string;
    handle: string | null;
  }> {
    if (this.did) {
      return { did: this.did, handle: this.handle };
    }

    const mainDb = await getDatabase();
    const row = await mainDb.getFirstAsync<{
      did: string | null;
      handle: string | null;
    }>(
      `SELECT b.did, b.handle
       FROM account a
       INNER JOIN bsky_account b ON b.id = a.bskyAccountID
       WHERE a.id = ?;`,
      [this.accountId],
    );
    if (!row?.did) {
      throw new Error(
        "This account has no Bluesky DID yet, so Cyd cannot name it in an archive.",
      );
    }
    return { did: row.did, handle: row.handle };
  }

  async deleteAccountStorage(): Promise<void> {
    await this.cleanup();
    try {
      const accountPaths = buildAccountPaths(
        this.getAccountType(),
        this.getAccountUUID(),
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
        `${accountPaths.base}bluesky-accounts/${this.getAccountUUID()}`,
      );
      deleteIfExists(
        `${accountPaths.base}SQLite/bluesky-accounts/${this.getAccountUUID()}`,
      );
      deleteIfExists(
        `${accountPaths.base}SQLite/accounts/${this.getAccountType()}-${this.getAccountUUID()}`,
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
    this.resetAgent();
    await super.cleanup();
  }
}

import {
  Agent,
  type AppBskyBookmarkGetBookmarks,
  type AppBskyFeedGetActorLikes,
  type AppBskyFeedGetAuthorFeed,
} from "@atproto/api";
import type { SQLiteDatabase } from "expo-sqlite";
import {
  PostPersistence,
  type PostPersistenceOptions,
} from "./post-persistence";
import type { ApiRequestFn } from "./rate-limiter";
import type { BlueskyProgress, PostPreviewData } from "./types";

type FeedViewPost = AppBskyFeedGetAuthorFeed.OutputSchema["feed"][number];
type FeedPostView = FeedViewPost["post"];
type LikesFeedItem = AppBskyFeedGetActorLikes.OutputSchema["feed"][number];
type BookmarksFeedItem =
  AppBskyBookmarkGetBookmarks.OutputSchema["bookmarks"][number];

type RequestExecutor = <T>(requestFn: ApiRequestFn<T>) => Promise<T>;

export interface PostIndexerDeps {
  getDb: () => SQLiteDatabase | null;
  getAgent: () => Agent | null;
  getDid: () => string | null;
  updateProgress: (updates: Partial<BlueskyProgress>) => void;
  waitForPause: () => Promise<void>;
  makeApiRequest: RequestExecutor;
  downloadMediaFromUrl: (url: string, did: string) => Promise<string>;
}

/**
 * Handles indexing of posts, likes, and bookmarks from Bluesky
 */
export class PostIndexer {
  private readonly pageSize = 100;
  private readonly postPersistence: PostPersistence;

  constructor(private readonly deps: PostIndexerDeps) {
    this.postPersistence = new PostPersistence({
      downloadMediaFromUrl: deps.downloadMediaFromUrl,
      getDid: deps.getDid,
    });
  }

  async indexPosts(): Promise<void> {
    const db = this.requireDb();
    const agent = this.requireAgent();
    const did = this.requireDid();

    this.deps.updateProgress({
      postsProgress: { current: 0, total: null, unknownTotal: true },
      currentAction: "Saving posts...",
      isRunning: true,
      error: null,
    });

    let cursor: string | undefined;
    let totalSaved = 0;

    try {
      while (true) {
        const response = await this.deps.makeApiRequest(() =>
          agent.app.bsky.feed.getAuthorFeed({
            actor: did,
            cursor,
            limit: this.pageSize,
          })
        );

        const feed = response.feed ?? [];
        const nextCursor = response.cursor;

        if (feed.length > 0) {
          const savedCount = await this.saveFeedPosts(db, feed, totalSaved);
          totalSaved += savedCount;

          this.deps.updateProgress({
            postsProgress: {
              current: totalSaved,
              total: null,
              unknownTotal: true,
            },
            currentAction: `Saved ${totalSaved.toLocaleString()} posts`,
          });
        }

        // Break if no more results OR no cursor (API returns empty feed with cursor when done)
        if (feed.length === 0 || !nextCursor) {
          break;
        }

        cursor = nextCursor;
      }

      // Once complete, we know the total
      this.deps.updateProgress({
        postsProgress: {
          current: totalSaved,
          total: totalSaved,
          unknownTotal: false,
        },
        currentAction: "Finished saving posts",
        isRunning: false,
      });
    } catch (error) {
      this.deps.updateProgress({
        isRunning: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  async indexLikes(): Promise<void> {
    const db = this.requireDb();
    const agent = this.requireAgent();
    const did = this.requireDid();

    this.deps.updateProgress({
      likesProgress: { current: 0, total: null, unknownTotal: true },
      currentAction: "Saving likes...",
      isRunning: true,
      error: null,
    });

    let cursor: string | undefined;
    let totalSaved = 0;

    try {
      while (true) {
        const response = await this.deps.makeApiRequest(() =>
          agent.app.bsky.feed.getActorLikes({
            actor: did,
            cursor,
            limit: this.pageSize,
          })
        );

        const feed = response.feed ?? [];
        const nextCursor = response.cursor;

        if (feed.length > 0) {
          const savedCount = await this.saveLikes(db, feed, totalSaved);
          totalSaved += savedCount;

          this.deps.updateProgress({
            likesProgress: {
              current: totalSaved,
              total: null,
              unknownTotal: true,
            },
            currentAction: `Saved ${totalSaved.toLocaleString()} likes`,
          });
        }

        // Break if no more results OR no cursor (API returns empty feed with cursor when done)
        if (feed.length === 0 || !nextCursor) {
          break;
        }

        cursor = nextCursor;
      }

      // Once complete, we know the total
      this.deps.updateProgress({
        likesProgress: {
          current: totalSaved,
          total: totalSaved,
          unknownTotal: false,
        },
        currentAction: "Finished saving likes",
        isRunning: false,
      });
    } catch (error) {
      this.deps.updateProgress({
        isRunning: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  async indexBookmarks(): Promise<void> {
    const db = this.requireDb();
    const agent = this.requireAgent();

    this.deps.updateProgress({
      bookmarksProgress: { current: 0, total: null, unknownTotal: true },
      currentAction: "Saving bookmarks...",
      isRunning: true,
      error: null,
    });

    let cursor: string | undefined;
    let totalSaved = 0;

    try {
      while (true) {
        const response = await this.deps.makeApiRequest(() =>
          agent.app.bsky.bookmark.getBookmarks({
            cursor,
            limit: this.pageSize,
          })
        );

        const feed = response.bookmarks ?? [];
        const nextCursor = response.cursor;

        if (feed.length > 0) {
          const savedCount = await this.saveBookmarks(db, feed, totalSaved);
          totalSaved += savedCount;

          this.deps.updateProgress({
            bookmarksProgress: {
              current: totalSaved,
              total: null,
              unknownTotal: true,
            },
            currentAction: `Saved ${totalSaved.toLocaleString()} bookmarks`,
          });
        }

        // Break if no more results OR no cursor (API returns empty feed with cursor when done)
        if (feed.length === 0 || !nextCursor) {
          break;
        }

        cursor = nextCursor;
      }

      // Once complete, we know the total
      this.deps.updateProgress({
        bookmarksProgress: {
          current: totalSaved,
          total: totalSaved,
          unknownTotal: false,
        },
        currentAction: "Finished saving bookmarks",
        isRunning: false,
      });
    } catch (error) {
      this.deps.updateProgress({
        isRunning: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  private async saveFeedPosts(
    db: SQLiteDatabase,
    feed: FeedViewPost[],
    totalSavedSoFar: number
  ): Promise<number> {
    let saved = 0;

    for (const item of feed) {
      await this.deps.waitForPause();
      const postView = item.post;

      let previewPost: PostPreviewData | null = null;
      await db.withTransactionAsync(async () => {
        previewPost = await this.postPersistence.persistPostView(db, postView);
      });

      if (previewPost) {
        saved += 1;
        const currentTotal = totalSavedSoFar + saved;
        // Update progress after each post for smooth UI updates
        this.deps.updateProgress({
          postsProgress: {
            current: currentTotal,
            total: null,
            unknownTotal: true,
          },
          currentAction: `Saved ${currentTotal.toLocaleString()} ${currentTotal === 1 ? "post" : "posts"}`,
          previewPost,
        });
      }
    }

    return saved;
  }

  private async saveLikes(
    db: SQLiteDatabase,
    feed: LikesFeedItem[],
    totalSavedSoFar: number
  ): Promise<number> {
    let saved = 0;

    for (const item of feed) {
      await this.deps.waitForPause();
      const postView = this.getPostViewFromFeedItem(item);
      if (!postView) {
        continue;
      }

      let previewPost: PostPreviewData | null = null;
      await db.withTransactionAsync(async () => {
        previewPost = await this.postPersistence.persistPostView(db, postView, {
          viewerLiked: 1,
          savedAt: Date.now(),
        } satisfies PostPersistenceOptions);
      });

      if (previewPost) {
        saved += 1;
        const currentTotal = totalSavedSoFar + saved;
        // Update progress after each like for smooth UI updates
        this.deps.updateProgress({
          likesProgress: {
            current: currentTotal,
            total: null,
            unknownTotal: true,
          },
          currentAction: `Saved ${currentTotal.toLocaleString()} ${currentTotal === 1 ? "like" : "likes"}`,
          previewPost,
        });
      }
    }

    return saved;
  }

  private async saveBookmarks(
    db: SQLiteDatabase,
    feed: BookmarksFeedItem[],
    totalSavedSoFar: number
  ): Promise<number> {
    let saved = 0;

    for (const item of feed) {
      await this.deps.waitForPause();
      const postView = this.getPostViewFromFeedItem(item);
      if (!postView) {
        continue;
      }

      const savedAt = Date.now();
      let previewPost: PostPreviewData | null = null;

      await db.withTransactionAsync(async () => {
        const persistedPost = await this.postPersistence.persistPostView(
          db,
          postView,
          {
            viewerBookmarked: 1,
            savedAt,
          } satisfies PostPersistenceOptions
        );
        if (!persistedPost) {
          return;
        }

        const subjectUri =
          (item as { subject?: { uri?: string } }).subject?.uri ?? postView.uri;
        const authorDid = postView.author.did ?? null;
        const authorHandle = postView.author.handle ?? null;
        const postCreatedAt =
          (postView as { indexedAt?: string }).indexedAt ??
          persistedPost.createdAt;

        await db.runAsync(
          `INSERT INTO bookmark (
            subjectUri,
            postAuthorDid, postAuthorHandle, postText, postCreatedAt,
            savedAt, deletedAt
          ) VALUES (?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(subjectUri) DO UPDATE SET
            postAuthorDid = excluded.postAuthorDid,
            postAuthorHandle = excluded.postAuthorHandle,
            postText = excluded.postText,
            postCreatedAt = excluded.postCreatedAt,
            savedAt = excluded.savedAt,
            deletedAt = NULL;`,
          [
            subjectUri,
            authorDid,
            authorHandle,
            persistedPost.text,
            postCreatedAt,
            savedAt,
          ]
        );

        previewPost = persistedPost;
      });

      if (previewPost) {
        saved += 1;
        const currentTotal = totalSavedSoFar + saved;
        // Update progress after each bookmark for smooth UI updates
        this.deps.updateProgress({
          bookmarksProgress: {
            current: currentTotal,
            total: null,
            unknownTotal: true,
          },
          currentAction: `Saved ${currentTotal.toLocaleString()} ${currentTotal === 1 ? "bookmark" : "bookmarks"}`,
          previewPost,
        });
      }
    }

    return saved;
  }

  private getPostViewFromFeedItem(
    item: FeedViewPost | BookmarksFeedItem
  ): FeedPostView | null {
    const fromPost = (item as { post?: FeedPostView }).post;
    if (this.hasRecord(fromPost)) {
      return fromPost;
    }

    const fromItem = (item as { item?: FeedPostView }).item;
    if (this.hasRecord(fromItem)) {
      return fromItem;
    }

    const fromSubject = (item as { subject?: FeedPostView }).subject;
    if (this.hasRecord(fromSubject)) {
      return fromSubject;
    }

    return null;
  }

  private hasRecord(
    view?: FeedPostView | null
  ): view is FeedPostView & { record: FeedPostView["record"] } {
    return Boolean(view && (view as { record?: unknown }).record);
  }

  private requireDb(): SQLiteDatabase {
    const db = this.deps.getDb();
    if (!db) {
      throw new Error("Database not initialized");
    }
    return db;
  }

  private requireAgent(): Agent {
    const agent = this.deps.getAgent();
    if (!agent) {
      throw new Error("Agent not initialized");
    }
    return agent;
  }

  private requireDid(): string {
    const did = this.deps.getDid();
    if (!did) {
      throw new Error("DID not initialized");
    }
    return did;
  }
}

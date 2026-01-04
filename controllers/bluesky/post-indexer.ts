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
            currentAction: `Saved ${totalSaved} posts`,
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
            currentAction: `Saved ${totalSaved} likes`,
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
            currentAction: `Saved ${totalSaved} bookmarks`,
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
    let lastPreviewPost: PostPreviewData | null = null;

    for (const item of feed) {
      await this.deps.waitForPause();
      const postView = item.post;

      await db.withTransactionAsync(async () => {
        const previewPost = await this.postPersistence.persistPostView(
          db,
          postView
        );
        if (!previewPost) {
          return;
        }

        saved += 1;
        lastPreviewPost = previewPost;
      });
    }

    // Update progress after transaction completes
    if (saved > 0) {
      this.deps.updateProgress({
        postsProgress: {
          current: totalSavedSoFar + saved,
          total: null,
          unknownTotal: true,
        },
        currentAction: `Saved ${totalSavedSoFar + saved} posts`,
        previewPost: lastPreviewPost,
      });
    }

    return saved;
  }

  private async saveLikes(
    db: SQLiteDatabase,
    feed: LikesFeedItem[],
    totalSavedSoFar: number
  ): Promise<number> {
    let saved = 0;
    let lastPreviewPost: PostPreviewData | null = null;

    for (const item of feed) {
      await this.deps.waitForPause();
      const postView = this.getPostViewFromFeedItem(item);
      if (!postView) {
        continue;
      }

      await db.withTransactionAsync(async () => {
        const previewPost = await this.postPersistence.persistPostView(
          db,
          postView,
          {
            viewerLiked: 1,
            savedAt: Date.now(),
          } satisfies PostPersistenceOptions
        );
        if (!previewPost) {
          return;
        }

        saved += 1;
        lastPreviewPost = previewPost;
      });
    }

    // Update progress after transaction completes
    if (saved > 0) {
      this.deps.updateProgress({
        likesProgress: {
          current: totalSavedSoFar + saved,
          total: null,
          unknownTotal: true,
        },
        currentAction: `Saved ${totalSavedSoFar + saved} likes`,
        previewPost: lastPreviewPost,
      });
    }

    return saved;
  }

  private async saveBookmarks(
    db: SQLiteDatabase,
    feed: BookmarksFeedItem[],
    totalSavedSoFar: number
  ): Promise<number> {
    let saved = 0;
    let lastPreviewPost: PostPreviewData | null = null;

    for (const item of feed) {
      await this.deps.waitForPause();
      const postView = this.getPostViewFromFeedItem(item);
      if (!postView) {
        continue;
      }

      const savedAt = Date.now();

      await db.withTransactionAsync(async () => {
        const previewPost = await this.postPersistence.persistPostView(
          db,
          postView,
          {
            viewerBookmarked: 1,
            savedAt,
          } satisfies PostPersistenceOptions
        );
        if (!previewPost) {
          return;
        }

        const subjectUri =
          (item as { subject?: { uri?: string } }).subject?.uri ?? postView.uri;
        const subjectCid =
          (item as { subject?: { cid?: string } }).subject?.cid ?? postView.cid;
        const authorDid = postView.author.did ?? null;
        const authorHandle = postView.author.handle ?? null;
        const postCreatedAt =
          (postView as { indexedAt?: string }).indexedAt ??
          previewPost.createdAt;

        await db.runAsync(
          `INSERT INTO bookmark (
            subjectUri, subjectCid,
            postAuthorDid, postAuthorHandle, postText, postCreatedAt,
            savedAt, deletedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(subjectUri) DO UPDATE SET
            subjectCid = excluded.subjectCid,
            postAuthorDid = excluded.postAuthorDid,
            postAuthorHandle = excluded.postAuthorHandle,
            postText = excluded.postText,
            postCreatedAt = excluded.postCreatedAt,
            savedAt = excluded.savedAt,
            deletedAt = NULL;`,
          [
            subjectUri,
            subjectCid,
            authorDid,
            authorHandle,
            previewPost.text,
            postCreatedAt,
            savedAt,
          ]
        );

        saved += 1;
        lastPreviewPost = previewPost;
      });
    }

    // Update progress after transaction completes
    if (saved > 0) {
      this.deps.updateProgress({
        bookmarksProgress: {
          current: totalSavedSoFar + saved,
          total: null,
          unknownTotal: true,
        },
        currentAction: `Saved ${totalSavedSoFar + saved} bookmarks`,
        previewPost: lastPreviewPost,
      });
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

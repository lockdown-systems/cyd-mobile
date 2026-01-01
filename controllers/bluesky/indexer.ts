import {
  Agent,
  type AppBskyActorDefs,
  type AppBskyBookmarkGetBookmarks,
  type AppBskyFeedGetActorLikes,
  type AppBskyFeedGetAuthorFeed,
  AppBskyFeedPost,
  AppBskyFeedRepost,
  type ChatBskyConvoGetMessages,
  type ChatBskyConvoListConvos,
} from "@atproto/api";
import type { SQLiteDatabase } from "expo-sqlite";

import type { ApiRequestFn } from "./rate-limiter";
import type {
  AutomationMediaAttachment,
  AutomationPostPreviewData,
  BlueskyProgress,
} from "./types";

type FeedViewPost = AppBskyFeedGetAuthorFeed.OutputSchema["feed"][number];

/**
 * Internal type for extracted media with additional metadata for database storage
 */
type ExtractedMedia = AutomationMediaAttachment & {
  blobCid: string;
  mimeType?: string | null;
  playlistUrl?: string | null;
};

/**
 * Internal type for extracted external link embeds
 */
type ExtractedExternal = {
  uri: string;
  title: string;
  description?: string | null;
  thumbUrl?: string | null;
};
type LikesFeedItem = AppBskyFeedGetActorLikes.OutputSchema["feed"][number];
type BookmarksFeedItem =
  AppBskyBookmarkGetBookmarks.OutputSchema["bookmarks"][number];
type FeedPostView = FeedViewPost["post"];
type FeedRecordInfo =
  | { kind: "post"; record: AppBskyFeedPost.Record }
  | { kind: "repost"; record: AppBskyFeedRepost.Record };

type RequestExecutor = <T>(requestFn: ApiRequestFn<T>) => Promise<T>;

interface IndexerDeps {
  getDb: () => SQLiteDatabase | null;
  getAgent: () => Agent | null;
  getDid: () => string | null;
  updateProgress: (updates: Partial<BlueskyProgress>) => void;
  waitForPause: () => Promise<void>;
  makeApiRequest: RequestExecutor;
  downloadMediaFromUrl: (url: string, did: string) => Promise<string>;
}

export class BlueskyIndexer {
  private readonly pageSize = 100;

  constructor(private readonly deps: IndexerDeps) {}

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

  private async saveFeedPosts(
    db: SQLiteDatabase,
    feed: FeedViewPost[],
    totalSavedSoFar: number
  ): Promise<number> {
    let saved = 0;
    let lastPreviewPost: AutomationPostPreviewData | null = null;

    for (const item of feed) {
      await this.deps.waitForPause();
      const postView = item.post;

      await db.withTransactionAsync(async () => {
        const previewPost = await this.persistPostView(db, postView);
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
    let lastPreviewPost: AutomationPostPreviewData | null = null;

    for (const item of feed) {
      await this.deps.waitForPause();
      const postView = this.getPostViewFromFeedItem(item);
      if (!postView) {
        continue;
      }

      await db.withTransactionAsync(async () => {
        const previewPost = await this.persistPostView(db, postView, {
          viewerLiked: 1,
          savedAt: Date.now(),
        });
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
    let lastPreviewPost: AutomationPostPreviewData | null = null;

    for (const item of feed) {
      await this.deps.waitForPause();
      const postView = this.getPostViewFromFeedItem(item);
      if (!postView) {
        continue;
      }

      const savedAt = Date.now();

      await db.withTransactionAsync(async () => {
        const previewPost = await this.persistPostView(db, postView, {
          viewerBookmarked: 1,
          savedAt,
        });
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

  private async persistPostView(
    db: SQLiteDatabase,
    postView: FeedPostView,
    options?: {
      viewerLiked?: number;
      viewerReposted?: number;
      viewerBookmarked?: number;
      savedAt?: number;
    }
  ): Promise<AutomationPostPreviewData | null> {
    const recordInfo = this.getRecordInfo(postView.record);
    if (!recordInfo) {
      console.warn(
        "[Indexer] Skipping feed item without recognized record",
        postView.record
      );
      return null;
    }

    const did = this.requireDid();
    await this.upsertProfile(db, postView.author);

    const postRecord = recordInfo.kind === "post" ? recordInfo.record : null;
    const repostRecord =
      recordInfo.kind === "repost" ? recordInfo.record : null;
    const savedAt = options?.savedAt ?? Date.now();

    const text = postRecord?.text ?? "";
    const facetsJSON =
      postRecord?.facets && postRecord.facets.length > 0
        ? JSON.stringify(postRecord.facets)
        : null;
    const embedType = postView.embed?.$type ?? null;
    const embedJSON = postView.embed ? JSON.stringify(postView.embed) : null;
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

    const viewerLiked = options?.viewerLiked ?? (postView.viewer?.like ? 1 : 0);
    const viewerReposted =
      options?.viewerReposted ?? (postView.viewer?.repost ? 1 : 0);
    const viewerBookmarked =
      options?.viewerBookmarked ?? (postView.viewer?.bookmarked ? 1 : 0);

    const createdAt =
      postRecord?.createdAt ??
      repostRecord?.createdAt ??
      (postView as { indexedAt?: string }).indexedAt ??
      new Date().toISOString();

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
        viewerLiked,
        viewerReposted,
        viewerBookmarked,
        createdAt,
        savedAt,
      ]
    );

    const media = this.extractMedia(postView);

    const downloadedMedia = await Promise.all(
      media.map(async (attachment, position) => {
        if (attachment.type === "image") {
          let localThumbPath: string | null | undefined = null;
          let localFullsizePath: string | null | undefined = null;
          try {
            if (attachment.thumbUrl) {
              localThumbPath = await this.deps.downloadMediaFromUrl(
                attachment.thumbUrl,
                did
              );
            }
            if (attachment.fullsizeUrl) {
              localFullsizePath = await this.deps.downloadMediaFromUrl(
                attachment.fullsizeUrl,
                did
              );
            }
          } catch (err) {
            console.warn("[persistPostView] Failed to download media", err);
          }

          // Insert into post_media table
          const downloadedAt =
            localThumbPath || localFullsizePath ? Date.now() : null;
          await db.runAsync(
            `INSERT INTO post_media (
              postUri, position, mediaType, blobCid, mimeType, alt,
              width, height, aspectRatioWidth, aspectRatioHeight,
              thumbUrl, fullsizeUrl, playlistUrl, localThumbPath, localFullsizePath, downloadedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(postUri, position) DO UPDATE SET
              mediaType = excluded.mediaType,
              blobCid = excluded.blobCid,
              mimeType = excluded.mimeType,
              alt = excluded.alt,
              width = excluded.width,
              height = excluded.height,
              aspectRatioWidth = excluded.aspectRatioWidth,
              aspectRatioHeight = excluded.aspectRatioHeight,
              thumbUrl = excluded.thumbUrl,
              fullsizeUrl = excluded.fullsizeUrl,
              playlistUrl = excluded.playlistUrl,
              localThumbPath = COALESCE(excluded.localThumbPath, post_media.localThumbPath),
              localFullsizePath = COALESCE(excluded.localFullsizePath, post_media.localFullsizePath),
              downloadedAt = COALESCE(excluded.downloadedAt, post_media.downloadedAt);`,
            [
              postView.uri,
              position,
              attachment.type,
              attachment.blobCid,
              attachment.mimeType ?? null,
              attachment.alt ?? null,
              attachment.width ?? null,
              attachment.height ?? null,
              attachment.width ?? null, // aspectRatioWidth
              attachment.height ?? null, // aspectRatioHeight
              attachment.thumbUrl ?? null,
              attachment.fullsizeUrl ?? null,
              null, // playlistUrl - images don't have this
              localThumbPath ?? null,
              localFullsizePath ?? null,
              downloadedAt,
            ]
          );

          return {
            ...attachment,
            localThumbPath,
            localFullsizePath,
          } satisfies AutomationMediaAttachment & ExtractedMedia;
        }

        // Handle video attachments
        if (attachment.type === "video") {
          let localThumbPath: string | null | undefined = null;
          try {
            if (attachment.thumbUrl) {
              localThumbPath = await this.deps.downloadMediaFromUrl(
                attachment.thumbUrl,
                did
              );
            }
          } catch (err) {
            console.warn(
              "[persistPostView] Failed to download video thumbnail",
              err
            );
          }

          // Insert video into post_media table
          const downloadedAt = localThumbPath ? Date.now() : null;
          await db.runAsync(
            `INSERT INTO post_media (
              postUri, position, mediaType, blobCid, mimeType, alt,
              width, height, aspectRatioWidth, aspectRatioHeight,
              thumbUrl, fullsizeUrl, playlistUrl, localThumbPath, localFullsizePath, downloadedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(postUri, position) DO UPDATE SET
              mediaType = excluded.mediaType,
              blobCid = excluded.blobCid,
              mimeType = excluded.mimeType,
              alt = excluded.alt,
              width = excluded.width,
              height = excluded.height,
              aspectRatioWidth = excluded.aspectRatioWidth,
              aspectRatioHeight = excluded.aspectRatioHeight,
              thumbUrl = excluded.thumbUrl,
              fullsizeUrl = excluded.fullsizeUrl,
              playlistUrl = excluded.playlistUrl,
              localThumbPath = COALESCE(excluded.localThumbPath, post_media.localThumbPath),
              localFullsizePath = COALESCE(excluded.localFullsizePath, post_media.localFullsizePath),
              downloadedAt = COALESCE(excluded.downloadedAt, post_media.downloadedAt);`,
            [
              postView.uri,
              position,
              attachment.type,
              attachment.blobCid,
              attachment.mimeType ?? null,
              attachment.alt ?? null,
              attachment.width ?? null,
              attachment.height ?? null,
              attachment.width ?? null, // aspectRatioWidth
              attachment.height ?? null, // aspectRatioHeight
              attachment.thumbUrl ?? null,
              null, // fullsizeUrl - videos use playlistUrl instead
              attachment.playlistUrl ?? null,
              localThumbPath ?? null,
              null, // localFullsizePath - not used for videos
              downloadedAt,
            ]
          );

          return {
            ...attachment,
            localThumbPath,
          } satisfies AutomationMediaAttachment & ExtractedMedia;
        }

        return attachment;
      })
    );

    // Extract and save external link embeds
    const external = this.extractExternal(postView);
    if (external) {
      let thumbLocalPath: string | null = null;
      if (external.thumbUrl) {
        try {
          thumbLocalPath = await this.deps.downloadMediaFromUrl(
            external.thumbUrl,
            did
          );
        } catch (err) {
          console.warn(
            "[persistPostView] Failed to download external thumb",
            err
          );
        }
      }

      await db.runAsync(
        `INSERT INTO post_external (
          postUri, uri, title, description, thumbUrl, thumbLocalPath
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(postUri) DO UPDATE SET
          uri = excluded.uri,
          title = excluded.title,
          description = excluded.description,
          thumbUrl = excluded.thumbUrl,
          thumbLocalPath = COALESCE(excluded.thumbLocalPath, post_external.thumbLocalPath);`,
        [
          postView.uri,
          external.uri,
          external.title,
          external.description ?? null,
          external.thumbUrl ?? null,
          thumbLocalPath,
        ]
      );
    }

    const author = postView.author;
    const likeCount =
      typeof postView.likeCount === "number" ? postView.likeCount : null;
    const repostCount =
      typeof postView.repostCount === "number" ? postView.repostCount : null;
    const replyCount =
      typeof postView.replyCount === "number" ? postView.replyCount : null;
    const quoteCount =
      typeof postView.quoteCount === "number" ? postView.quoteCount : null;

    const previewPost: AutomationPostPreviewData = {
      uri: String(postView.uri ?? ""),
      cid: String(postView.cid ?? ""),
      text: String(text ?? ""),
      createdAt:
        postRecord?.createdAt ??
        repostRecord?.createdAt ??
        (postView as { indexedAt?: string }).indexedAt ??
        new Date().toISOString(),
      author: {
        did: String(author.did ?? ""),
        handle: String(author.handle ?? ""),
        displayName: author.displayName ?? null,
        avatarUrl: author.avatar ?? null,
        avatarDataURI:
          (author as { avatarDataURI?: string | null }).avatarDataURI ?? null,
      },
      likeCount,
      repostCount,
      replyCount,
      quoteCount,
      isRepost: recordInfo.kind === "repost",
      quotedPostUri,
      media: downloadedMedia,
    } satisfies AutomationPostPreviewData;

    return previewPost;
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

  private async upsertProfile(
    db: SQLiteDatabase,
    profile: AppBskyActorDefs.ProfileViewBasic
  ): Promise<void> {
    const now = Date.now();
    const description =
      (profile as { description?: string }).description ?? null;

    await db.runAsync(
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

  private extractMedia(postView: FeedPostView): ExtractedMedia[] {
    const embed = (postView as { embed?: unknown }).embed as
      | {
          $type?: string;
          images?: Record<string, unknown>[];
          cid?: string;
          playlist?: string;
          thumbnail?: string;
          aspectRatio?: { width?: number; height?: number };
          alt?: string;
        }
      | undefined;

    const attachments: ExtractedMedia[] = [];

    // Handle video embeds (app.bsky.embed.video#view)
    if (embed?.$type === "app.bsky.embed.video#view" && embed.cid) {
      const aspect = embed.aspectRatio;
      attachments.push({
        type: "video",
        blobCid: embed.cid,
        mimeType: "video/mp4",
        thumbUrl: embed.thumbnail ?? null,
        fullsizeUrl: null,
        playlistUrl: embed.playlist ?? null,
        alt: embed.alt ?? null,
        width: aspect?.width ?? null,
        height: aspect?.height ?? null,
      });
    }

    // Handle image embeds (app.bsky.embed.images#view)
    const images = Array.isArray(embed?.images) ? embed.images : [];

    for (const image of images) {
      const thumb = (image as { thumb?: string }).thumb ?? null;
      const fullsize = (image as { fullsize?: string }).fullsize ?? null;
      if (!thumb && !fullsize) continue;

      // Try to extract blobCid from the image object (record embed has image.ref.$link)
      const imageData = image as {
        image?: { ref?: { $link?: string }; mimeType?: string };
      };
      let blobCid = imageData.image?.ref?.$link ?? null;
      const mimeType = imageData.image?.mimeType ?? null;

      // If no blobCid in the image object, try to extract from the URL
      // Bluesky CDN URLs look like: https://cdn.bsky.app/img/feed_fullsize/plain/{did}/{cid}@jpeg
      if (!blobCid && fullsize) {
        blobCid = this.extractBlobCidFromUrl(fullsize);
      }
      if (!blobCid && thumb) {
        blobCid = this.extractBlobCidFromUrl(thumb);
      }

      // Generate a fallback blobCid from the URL if we still don't have one
      if (!blobCid) {
        blobCid = fullsize ?? thumb ?? `unknown-${Date.now()}`;
      }

      const alt = (image as { alt?: string }).alt ?? null;
      const aspect = (
        image as { aspectRatio?: { width?: number; height?: number } }
      ).aspectRatio;
      const width = aspect?.width ?? null;
      const height = aspect?.height ?? null;

      attachments.push({
        type: "image",
        blobCid,
        mimeType,
        thumbUrl: thumb,
        fullsizeUrl: fullsize,
        alt,
        width,
        height,
      });
    }

    return attachments;
  }

  /**
   * Extract blob CID from Bluesky CDN URL
   * URLs look like: https://cdn.bsky.app/img/feed_fullsize/plain/{did}/{cid}@jpeg
   */
  private extractBlobCidFromUrl(url: string): string | null {
    try {
      // Match patterns like /plain/did:plc:xxx/bafyxxx@jpeg
      const match = url.match(/\/plain\/[^/]+\/([^@/]+)/);
      if (match?.[1]) {
        return match[1];
      }
      return null;
    } catch {
      return null;
    }
  }

  private extractExternal(postView: FeedPostView): ExtractedExternal | null {
    const embed = (postView as { embed?: unknown }).embed as
      | { external?: Record<string, unknown>; $type?: string }
      | undefined;

    // Check for app.bsky.embed.external#view or similar
    if (!embed?.external) {
      return null;
    }

    const external = embed.external as {
      uri?: string;
      title?: string;
      description?: string;
      thumb?: string;
    };

    if (!external.uri || !external.title) {
      return null;
    }

    return {
      uri: external.uri,
      title: external.title,
      description: external.description ?? null,
      thumbUrl: external.thumb ?? null,
    };
  }

  async indexChatConvos(): Promise<void> {
    const db = this.requireDb();
    const agent = this.requireAgent();

    this.deps.updateProgress({
      currentAction: "Saving chat conversations...",
      isRunning: true,
      error: null,
    });

    let cursor: string | undefined;
    let totalSaved = 0;

    try {
      while (true) {
        const response = await this.deps.makeApiRequest(() =>
          agent.chat.bsky.convo.listConvos({
            cursor,
            limit: 50,
          })
        );

        const convos = response.convos ?? [];
        const nextCursor = response.cursor;

        if (convos.length > 0) {
          const savedCount = await this.saveConversations(db, convos);
          totalSaved += savedCount;

          this.deps.updateProgress({
            currentAction: `Saved ${totalSaved} conversations`,
          });
        }

        if (!nextCursor || convos.length === 0) {
          break;
        }

        cursor = nextCursor;
      }

      this.deps.updateProgress({
        currentAction: "Finished saving conversations",
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

  async indexChatMessages(): Promise<void> {
    const db = this.requireDb();
    const agent = this.requireAgent();

    this.deps.updateProgress({
      currentAction: "Loading conversations...",
      isRunning: true,
      error: null,
    });

    try {
      // Get all conversation IDs from the database
      const convos = await db.getAllAsync<{ convoId: string }>(
        `SELECT convoId FROM conversation ORDER BY updatedAt DESC`
      );

      if (convos.length === 0) {
        this.deps.updateProgress({
          currentAction: "No conversations found",
          isRunning: false,
        });
        return;
      }

      let totalSaved = 0;
      let convoIndex = 0;

      for (const { convoId } of convos) {
        convoIndex++;
        let cursor: string | undefined;

        this.deps.updateProgress({
          currentAction: `Saving messages from conversation ${convoIndex}/${convos.length}...`,
        });

        while (true) {
          const response = await this.deps.makeApiRequest(() =>
            agent.chat.bsky.convo.getMessages({
              convoId,
              cursor,
              limit: 100,
            })
          );

          const messages = response.messages ?? [];
          const nextCursor = response.cursor;

          if (messages.length > 0) {
            const savedCount = await this.saveMessages(db, convoId, messages);
            totalSaved += savedCount;

            this.deps.updateProgress({
              currentAction: `Saved ${totalSaved} messages (${convoIndex}/${convos.length} conversations)`,
            });
          }

          if (!nextCursor || messages.length === 0) {
            break;
          }

          cursor = nextCursor;
        }
      }

      this.deps.updateProgress({
        currentAction: `Finished saving ${totalSaved} messages`,
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

  private async saveConversations(
    db: SQLiteDatabase,
    convos: ChatBskyConvoListConvos.OutputSchema["convos"]
  ): Promise<number> {
    let savedCount = 0;
    const now = Date.now();

    for (const convo of convos) {
      // Extract member DIDs as JSON array
      const memberDids = JSON.stringify(convo.members?.map((m) => m.did) ?? []);

      // Extract last message data safely
      const lastMsg = convo.lastMessage as
        | {
            id?: string;
            text?: string;
            sentAt?: string;
            sender?: { did?: string };
          }
        | undefined;

      await db.runAsync(
        `INSERT OR REPLACE INTO conversation (
          convoId, rev, memberDids, muted, status, unreadCount,
          lastMessageId, lastMessageText, lastMessageSentAt, lastMessageSenderDid,
          savedAt, updatedAt, leftAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          convo.id,
          convo.rev ?? null,
          memberDids,
          convo.muted ? 1 : 0,
          (convo as { status?: string }).status ?? null,
          convo.unreadCount ?? 0,
          lastMsg?.id ?? null,
          lastMsg?.text ?? null,
          lastMsg?.sentAt ?? null,
          lastMsg?.sender?.did ?? null,
          now,
          lastMsg?.sentAt ? new Date(lastMsg.sentAt).getTime() : now,
          null,
        ]
      );

      // Save profile information for each member
      for (const member of convo.members ?? []) {
        // Cast chat profile to app profile for upsertProfile compatibility
        await this.upsertProfile(
          db,
          member as unknown as AppBskyActorDefs.ProfileViewBasic
        );
      }

      savedCount++;
    }

    return savedCount;
  }

  private async saveMessages(
    db: SQLiteDatabase,
    convoId: string,
    messages: ChatBskyConvoGetMessages.OutputSchema["messages"]
  ): Promise<number> {
    let savedCount = 0;
    const now = Date.now();

    for (const message of messages) {
      // Type guard and extract message data
      const msg = message as
        | {
            id?: string;
            rev?: string;
            text?: string;
            sentAt?: string;
            sender?: { did?: string };
            facets?: unknown[];
            embed?: unknown;
          }
        | undefined;

      // Only process messages that have text content
      if (!msg?.text) {
        continue;
      }

      await db.runAsync(
        `INSERT OR REPLACE INTO message (
          messageId, convoId, rev, senderDid, text, facetsJSON, embedJSON, sentAt, savedAt, deletedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          msg.id ?? null,
          convoId,
          msg.rev ?? null,
          msg.sender?.did ?? null,
          msg.text,
          msg.facets ? JSON.stringify(msg.facets) : null,
          msg.embed ? JSON.stringify(msg.embed) : null,
          msg.sentAt ?? null,
          now,
          null,
        ]
      );

      // Save sender profile if available
      if (msg.sender) {
        await this.upsertProfile(
          db,
          msg.sender as AppBskyActorDefs.ProfileViewBasic
        );
      }

      savedCount++;
    }

    return savedCount;
  }
}

import {
  Agent,
  type AppBskyActorDefs,
  type AppBskyFeedGetAuthorFeed,
  AppBskyFeedPost,
  AppBskyFeedRepost,
} from "@atproto/api";
import type { SQLiteDatabase } from "expo-sqlite";

import type { ApiRequestFn } from "./rate-limiter";
import type {
  AutomationMediaAttachment,
  AutomationPostPreviewData,
  BlueskyProgress,
} from "./types";

type FeedViewPost = AppBskyFeedGetAuthorFeed.OutputSchema["feed"][number];
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
}

export class BlueskyIndexer {
  private readonly pageSize = 100;

  constructor(private readonly deps: IndexerDeps) {}

  async indexPosts(): Promise<void> {
    const db = this.requireDb();
    const agent = this.requireAgent();
    const did = this.requireDid();

    let postsTotal: number | null = null;
    try {
      const profile = await agent.getProfile({ actor: did });
      const profilePosts = profile.data?.postsCount;
      if (typeof profilePosts === "number" && profilePosts >= 0) {
        postsTotal = profilePosts;
      }
    } catch (err) {
      console.warn("[Indexer] Unable to fetch profile posts count", err);
    }

    this.deps.updateProgress({
      postsSaved: 0,
      postsTotal,
      currentAction: "Indexing posts...",
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
          const savedCount = await this.saveFeedPosts(
            db,
            feed,
            totalSaved,
            postsTotal
          );
          totalSaved += savedCount;

          this.deps.updateProgress({
            postsSaved: totalSaved,
            postsTotal,
            currentAction: `Indexed ${totalSaved} posts`,
          });
        }

        if (!nextCursor) {
          break;
        }

        cursor = nextCursor;
      }

      const finalTotal = Math.max(postsTotal ?? 0, totalSaved);
      this.deps.updateProgress({
        postsSaved: totalSaved,
        postsTotal: finalTotal,
        currentAction: "Post indexing complete",
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
    totalSavedSoFar: number,
    postsTotal: number | null
  ): Promise<number> {
    let saved = 0;

    await db.withTransactionAsync(async () => {
      for (const item of feed) {
        await this.deps.waitForPause();
        const postView = item.post;
        const recordInfo = this.getRecordInfo(postView.record);
        if (!recordInfo) {
          continue;
        }

        await this.upsertProfile(db, postView.author);

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

        const media = this.extractMedia(postView);

        const author = postView.author;
        const likeCount =
          typeof postView.likeCount === "number" ? postView.likeCount : null;
        const repostCount =
          typeof postView.repostCount === "number"
            ? postView.repostCount
            : null;
        const replyCount =
          typeof postView.replyCount === "number" ? postView.replyCount : null;
        const quoteCount =
          typeof postView.quoteCount === "number" ? postView.quoteCount : null;

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const previewPost: AutomationPostPreviewData = {
          uri: String(postView.uri ?? ""),
          cid: String(postView.cid ?? ""),
          text: String(text ?? ""),
          createdAt:
            postRecord?.createdAt ??
            repostRecord?.createdAt ??
            postView.indexedAt ??
            new Date().toISOString(),
          author: {
            did: String(author.did ?? ""),
            handle: String(author.handle ?? ""),
            displayName: author.displayName ?? null,
            avatarUrl: author.avatar ?? null,
            avatarDataURI:
              (author as { avatarDataURI?: string | null }).avatarDataURI ??
              null,
          },
          likeCount,
          repostCount,
          replyCount,
          quoteCount,
          isRepost: recordInfo.kind === "repost",
          quotedPostUri,
          media,
        } satisfies AutomationPostPreviewData;

        // Emit per-post progress for debugging UI visibility.
        saved += 1;
        this.deps.updateProgress({
          postsSaved: totalSavedSoFar + saved,
          postsTotal: postsTotal ?? undefined,
          currentAction: `Indexed ${totalSavedSoFar + saved} posts`,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          previewPost,
        });

        // Debug: slow down to visualize progress updates.
        console.log("[saveFeedPosts] before sleep");
        await new Promise((resolve) => setTimeout(resolve, 200));
        console.log("[saveFeedPosts] after sleep");
      }
    });

    return saved;
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

  private extractMedia(postView: FeedPostView): AutomationMediaAttachment[] {
    const embed = (postView as { embed?: unknown }).embed as
      | { images?: Record<string, unknown>[] }
      | undefined;

    const images = Array.isArray(embed?.images) ? embed.images : [];

    const attachments: AutomationMediaAttachment[] = [];

    for (const image of images) {
      const thumb = (image as { thumb?: string }).thumb ?? null;
      const fullsize = (image as { fullsize?: string }).fullsize ?? null;
      if (!thumb && !fullsize) continue;

      const alt = (image as { alt?: string }).alt ?? null;
      const aspect = (
        image as { aspectRatio?: { width?: number; height?: number } }
      ).aspectRatio;
      const width = aspect?.width ?? null;
      const height = aspect?.height ?? null;

      attachments.push({
        type: "image",
        thumbUrl: thumb,
        fullsizeUrl: fullsize,
        alt,
        width,
        height,
      });
    }

    return attachments;
  }
}

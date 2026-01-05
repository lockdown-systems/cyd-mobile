import { extractEmbeddedPost } from "@/utils/embeddedPost";
import {
  AppBskyFeedPost,
  AppBskyFeedRepost,
  type AppBskyActorDefs,
  type AppBskyFeedGetAuthorFeed,
} from "@atproto/api";
import type { SQLiteDatabase } from "expo-sqlite";
import { MediaExtractor, type ExtractedMedia } from "./media-extractor";
import type { ExternalEmbed, PostPreviewData } from "./types";

type FeedViewPost = AppBskyFeedGetAuthorFeed.OutputSchema["feed"][number];
type FeedPostView = FeedViewPost["post"];
type FeedRecordInfo =
  | { kind: "post"; record: AppBskyFeedPost.Record }
  | { kind: "repost"; record: AppBskyFeedRepost.Record };

export interface PostPersistenceOptions {
  viewerLiked?: number;
  viewerReposted?: number;
  viewerBookmarked?: number;
  savedAt?: number;
}

export interface PostPersistenceDeps {
  downloadMediaFromUrl: (url: string, did: string) => Promise<string>;
  getDid: () => string | null;
}

/**
 * Handles persistence of Bluesky posts to the local database
 */
export class PostPersistence {
  private readonly mediaExtractor = new MediaExtractor();

  constructor(private readonly deps: PostPersistenceDeps) {}

  /**
   * Persist a post view to the database and return preview data
   */
  async persistPostView(
    db: SQLiteDatabase,
    postView: FeedPostView,
    options?: PostPersistenceOptions
  ): Promise<PostPreviewData | null> {
    const recordInfo = this.getRecordInfo(postView.record);
    if (!recordInfo) {
      console.warn(
        "[PostPersistence] Skipping feed item without recognized record",
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
      ? this.mediaExtractor.extractQuotedPostUri(postView.embed)
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

    const quotedPost = extractEmbeddedPost(postView.embed, createdAt);

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

    const media = this.mediaExtractor.extractMedia(postView);
    const downloadedMedia = await this.downloadAndSaveMedia(
      db,
      postView.uri,
      media,
      did
    );

    // Extract and save external link embeds
    const externalEmbed = await this.saveExternalEmbed(db, postView);

    // Save external embed for quoted post if it has one
    let quotedPostWithLocalEmbed = quotedPost;
    if (quotedPost?.externalEmbed) {
      const savedQuotedExternal = await this.saveQuotedPostExternalEmbed(
        db,
        quotedPost
      );
      if (savedQuotedExternal) {
        quotedPostWithLocalEmbed = {
          ...quotedPost,
          externalEmbed: savedQuotedExternal,
        };
      }
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

    const previewPost: PostPreviewData = {
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
      isReply: !!postRecord?.reply,
      quotedPostUri,
      quotedPost: quotedPostWithLocalEmbed,
      media: downloadedMedia,
      facets: postRecord?.facets ?? null,
      externalEmbed,
    } satisfies PostPreviewData;

    return previewPost;
  }

  /**
   * Upsert a profile to the database
   */
  async upsertProfile(
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

  private async downloadAndSaveMedia(
    db: SQLiteDatabase,
    postUri: string,
    media: ExtractedMedia[],
    did: string
  ): Promise<ExtractedMedia[]> {
    return await Promise.all(
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
            console.warn("[PostPersistence] Failed to download media", err);
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
              postUri,
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
          };
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
              "[PostPersistence] Failed to download video thumbnail",
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
              postUri,
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
          };
        }

        return attachment;
      })
    );
  }

  private async saveExternalEmbed(
    db: SQLiteDatabase,
    postView: FeedPostView
  ): Promise<ExternalEmbed | null> {
    const external = this.mediaExtractor.extractExternal(postView);
    if (!external) {
      return null;
    }

    return this.saveExternalEmbedData(db, postView.uri, {
      uri: external.uri,
      title: external.title,
      description: external.description ?? undefined,
      thumbUrl: external.thumbUrl ?? undefined,
    });
  }

  /**
   * Save external embed data for a quoted post.
   * Downloads the thumbnail and stores it locally.
   */
  private async saveQuotedPostExternalEmbed(
    db: SQLiteDatabase,
    quotedPost: PostPreviewData
  ): Promise<ExternalEmbed | null> {
    if (!quotedPost.externalEmbed || !quotedPost.uri) {
      return null;
    }

    const external = quotedPost.externalEmbed;
    return this.saveExternalEmbedData(db, quotedPost.uri, {
      uri: external.uri,
      title: external.title,
      description: external.description ?? undefined,
      thumbUrl: external.thumbUrl ?? undefined,
    });
  }

  private async saveExternalEmbedData(
    db: SQLiteDatabase,
    postUri: string,
    external: {
      uri: string;
      title: string;
      description?: string;
      thumbUrl?: string;
    }
  ): Promise<ExternalEmbed | null> {
    const did = this.requireDid();
    let thumbLocalPath: string | null = null;
    if (external.thumbUrl) {
      try {
        thumbLocalPath = await this.deps.downloadMediaFromUrl(
          external.thumbUrl,
          did
        );
      } catch (err) {
        console.warn(
          "[PostPersistence] Failed to download external thumb",
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
        postUri,
        external.uri,
        external.title,
        external.description ?? null,
        external.thumbUrl ?? null,
        thumbLocalPath,
      ]
    );

    return {
      uri: external.uri,
      title: external.title,
      description: external.description ?? null,
      thumbUrl: external.thumbUrl ?? null,
      thumbLocalPath,
    };
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

  private requireDid(): string {
    const did = this.deps.getDid();
    if (!did) {
      throw new Error("DID not initialized");
    }
    return did;
  }
}

import type { AppBskyFeedGetAuthorFeed } from "@atproto/api";
import type { MediaAttachment } from "./types";

type FeedViewPost = AppBskyFeedGetAuthorFeed.OutputSchema["feed"][number];
type FeedPostView = FeedViewPost["post"];

/**
 * Internal type for extracted media with additional metadata for database storage
 */
export type ExtractedMedia = MediaAttachment & {
  blobCid: string;
  mimeType?: string | null;
};

/**
 * Internal type for extracted external link embeds
 */
export type ExtractedExternal = {
  uri: string;
  title: string;
  description?: string | null;
  thumbUrl?: string | null;
};

/**
 * Utility class for extracting media and external links from Bluesky posts
 */
export class MediaExtractor {
  /**
   * Extract all media attachments from a post view
   */
  extractMedia(postView: FeedPostView): ExtractedMedia[] {
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

  /**
   * Extract external link embed from a post view
   */
  extractExternal(postView: FeedPostView): ExtractedExternal | null {
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

  /**
   * Extract quoted post URI from an embed (searches recursively)
   */
  extractQuotedPostUri(
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
}

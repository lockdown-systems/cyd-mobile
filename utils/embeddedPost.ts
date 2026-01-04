import type {
  ExternalEmbed,
  MediaAttachment,
  PostPreviewData,
} from "@/controllers/bluesky/types";

const MAX_QUOTE_DEPTH = 20;

function extractMediaFromEmbedValue(embed: unknown): MediaAttachment[] {
  if (!embed || typeof embed !== "object") return [];

  const value = embed as Record<string, unknown> & {
    images?: unknown;
    playlist?: unknown;
    thumbnail?: unknown;
    alt?: unknown;
    video?: unknown;
  };

  const media: MediaAttachment[] = [];

  const images = value.images;
  if (Array.isArray(images)) {
    for (const img of images) {
      if (!img || typeof img !== "object") continue;
      const imgObj = img as Record<string, unknown>;
      const aspect = imgObj.aspectRatio as Record<string, unknown> | undefined;
      media.push({
        type: "image",
        thumbUrl: typeof imgObj.thumb === "string" ? imgObj.thumb : undefined,
        fullsizeUrl:
          typeof imgObj.fullsize === "string" ? imgObj.fullsize : undefined,
        alt: typeof imgObj.alt === "string" ? imgObj.alt : undefined,
        width:
          aspect && typeof aspect.width === "number" ? aspect.width : undefined,
        height:
          aspect && typeof aspect.height === "number"
            ? aspect.height
            : undefined,
      });
    }
  }

  const video = value.video as Record<string, unknown> | undefined;
  let playlist: string | undefined;
  if (video && typeof video.playlist === "string") {
    playlist = video.playlist;
  }
  if (!playlist && typeof value.playlist === "string") {
    playlist = value.playlist;
  }
  if (playlist) {
    const thumbCandidate =
      video && typeof video.thumbnail === "string"
        ? video.thumbnail
        : undefined;
    const thumbFallback =
      typeof value.thumbnail === "string" ? value.thumbnail : undefined;
    const altCandidate =
      video && typeof video.alt === "string" ? video.alt : undefined;
    const altFallback = typeof value.alt === "string" ? value.alt : undefined;

    media.push({
      type: "video",
      playlistUrl: playlist,
      thumbUrl: thumbCandidate ?? thumbFallback,
      alt: altCandidate ?? altFallback,
    });
  }

  return media;
}

function extractExternalFromEmbed(embeds: unknown[]): ExternalEmbed | null {
  for (const embed of embeds) {
    if (!embed || typeof embed !== "object") continue;
    const embedObj = embed as {
      external?: {
        uri?: string;
        title?: string;
        description?: string;
        thumb?: string;
      };
      $type?: string;
    };

    // Check for external embed (link preview)
    if (
      embedObj.external &&
      typeof embedObj.external.uri === "string" &&
      typeof embedObj.external.title === "string"
    ) {
      return {
        uri: embedObj.external.uri,
        title: embedObj.external.title,
        description: embedObj.external.description ?? null,
        thumbUrl: embedObj.external.thumb ?? null,
      };
    }
  }
  return null;
}

function safeParseEmbed(embedJson?: string | null): unknown {
  if (!embedJson) return null;
  try {
    return JSON.parse(embedJson);
  } catch {
    return null;
  }
}

function pickRecord(embed: unknown): Record<string, unknown> | null {
  if (!embed || typeof embed !== "object") return null;
  const embedObj = embed as { record?: unknown };
  // Only return the record if it actually exists (don't fall back to embed itself)
  if (embedObj.record && typeof embedObj.record === "object") {
    return embedObj.record as Record<string, unknown>;
  }
  return null;
}

/**
 * Find a nested record embed from various possible locations in the Bluesky embed structure.
 * The API can place nested record embeds in:
 * - record.embeds[n] (hydrated view of what the quoted post embeds)
 * - record.value.embed.record (raw record data)
 * - embed.media.record (for recordWithMedia embeds)
 */
function findNestedRecordEmbed(
  record: Record<string, unknown>
): Record<string, unknown> | null {
  // Check record.embeds array first (hydrated embed views)
  const embeds = record.embeds as unknown[] | undefined;
  if (Array.isArray(embeds)) {
    for (const e of embeds) {
      if (!e || typeof e !== "object") continue;
      const embedObj = e as { record?: unknown; $type?: string };
      // Look for record embeds
      if (
        embedObj.record &&
        typeof embedObj.record === "object" &&
        typeof (embedObj.record as { uri?: unknown }).uri === "string"
      ) {
        return embedObj.record as Record<string, unknown>;
      }
    }
  }

  // Check value.embed.record (raw record structure)
  const value = record.value as Record<string, unknown> | undefined;
  const valueEmbed = value?.embed as { record?: unknown } | undefined;
  if (
    valueEmbed?.record &&
    typeof valueEmbed.record === "object" &&
    typeof (valueEmbed.record as { uri?: unknown }).uri === "string"
  ) {
    return valueEmbed.record as Record<string, unknown>;
  }

  return null;
}

export function extractEmbeddedPost(
  embed: unknown,
  fallbackCreatedAt: string,
  depth = 0
): PostPreviewData | null {
  if (depth > MAX_QUOTE_DEPTH) return null;

  const record = pickRecord(embed);
  if (!record) return null;

  // Only treat this as a quoted post if it looks like a record with a URI.
  if (typeof (record as { uri?: unknown }).uri !== "string") {
    return null;
  }

  const value = record.value as Record<string, unknown> | undefined;
  const author = record.author as Record<string, unknown> | undefined;

  const uri = typeof record.uri === "string" ? record.uri : null;
  const cid = typeof record.cid === "string" ? record.cid : uri;

  const text = typeof value?.text === "string" ? value.text : "";
  const createdAt =
    typeof value?.createdAt === "string" ? value.createdAt : fallbackCreatedAt;

  // For media and external embeds, check both record.embeds (hydrated) and value.embed (raw)
  const embeds = record.embeds as unknown[] | undefined;
  let media: MediaAttachment[] = [];
  let externalEmbed: ExternalEmbed | null = null;

  if (Array.isArray(embeds)) {
    // Extract media
    for (const e of embeds) {
      if (!e || typeof e !== "object") continue;
      const extracted = extractMediaFromEmbedValue(e);
      if (extracted.length > 0) {
        media = extracted;
        break;
      }
    }
    // Extract external embed
    externalEmbed = extractExternalFromEmbed(embeds);
  }
  if (media.length === 0 && value?.embed) {
    media = extractMediaFromEmbedValue(value.embed);
  }

  // Find nested quoted post using improved logic
  const nestedRecord = findNestedRecordEmbed(record);

  let nestedQuoted: PostPreviewData | null = null;
  let nestedQuotedUri: string | null = null;

  if (nestedRecord && depth < MAX_QUOTE_DEPTH) {
    nestedQuotedUri =
      typeof nestedRecord.uri === "string" ? nestedRecord.uri : null;
    // Wrap the nested record in a structure that extractEmbeddedPost expects
    nestedQuoted = extractEmbeddedPost(
      { record: nestedRecord },
      createdAt,
      depth + 1
    );
  }

  // Extract engagement counts from the record (these come from the hydrated view)
  const likeCount =
    typeof record.likeCount === "number" ? record.likeCount : null;
  const repostCount =
    typeof record.repostCount === "number" ? record.repostCount : null;
  const replyCount =
    typeof record.replyCount === "number" ? record.replyCount : null;
  const quoteCount =
    typeof record.quoteCount === "number" ? record.quoteCount : null;

  const quotedPost: PostPreviewData = {
    uri: uri ?? "",
    cid: cid ?? "",
    text,
    createdAt,
    author: {
      did: typeof author?.did === "string" ? author.did : "unknown",
      handle: typeof author?.handle === "string" ? author.handle : "unknown",
      displayName:
        typeof author?.displayName === "string" ? author.displayName : null,
      avatarUrl: typeof author?.avatar === "string" ? author.avatar : null,
      avatarDataURI:
        typeof (author as { avatarDataURI?: unknown })?.avatarDataURI ===
        "string"
          ? ((author as { avatarDataURI?: string }).avatarDataURI as string)
          : null,
    },
    likeCount,
    repostCount,
    replyCount,
    quoteCount,
    media: media.length > 0 ? media : undefined,
    externalEmbed,
    quotedPostUri: nestedQuotedUri,
    quotedPost: nestedQuoted,
  };

  return quotedPost;
}

export function extractEmbeddedPostFromJson(
  embedJson: string | null | undefined,
  fallbackCreatedAt: string
): PostPreviewData | null {
  const embed = safeParseEmbed(embedJson);
  return extractEmbeddedPost(embed, fallbackCreatedAt, 0);
}

export function extractMediaFromEmbeddedRecord(
  embedJson: unknown
): MediaAttachment[] {
  return extractMediaFromEmbedValue(embedJson);
}

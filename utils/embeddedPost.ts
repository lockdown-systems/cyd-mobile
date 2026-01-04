import type {
  MediaAttachment,
  PostPreviewData,
} from "@/controllers/bluesky/types";

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
  const record = embedObj.record ?? embed;
  if (record && typeof record === "object") {
    return record as Record<string, unknown>;
  }
  return null;
}

export function extractEmbeddedPost(
  embed: unknown,
  fallbackCreatedAt: string
): PostPreviewData | null {
  const record = pickRecord(embed);
  if (!record) return null;

  const value = record.value as Record<string, unknown> | undefined;
  const author = record.author as Record<string, unknown> | undefined;

  const uri = typeof record.uri === "string" ? record.uri : null;
  const cid = typeof record.cid === "string" ? record.cid : uri;

  const text = typeof value?.text === "string" ? value.text : "";
  const createdAt =
    typeof value?.createdAt === "string" ? value.createdAt : fallbackCreatedAt;

  const mediaSource =
    (embed as { media?: unknown })?.media ?? (value ? value.embed : undefined);
  const media = extractMediaFromEmbedValue(mediaSource);

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
    media: media.length > 0 ? media : undefined,
    quotedPostUri:
      typeof (value as { embed?: { record?: { uri?: string } } })?.embed?.record
        ?.uri === "string"
        ? ((value as { embed?: { record?: { uri?: string } } })?.embed?.record
            ?.uri as string)
        : null,
  };

  return quotedPost;
}

export function extractEmbeddedPostFromJson(
  embedJson: string | null | undefined,
  fallbackCreatedAt: string
): PostPreviewData | null {
  const embed = safeParseEmbed(embedJson);
  return extractEmbeddedPost(embed, fallbackCreatedAt);
}

export function extractMediaFromEmbeddedRecord(
  embedJson: unknown
): MediaAttachment[] {
  return extractMediaFromEmbedValue(embedJson);
}

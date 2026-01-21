import React, { useCallback, useMemo, useState } from "react";
import {
  Image,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type {
  MediaAttachment,
  MessagePreviewData,
  PostPreviewData,
} from "@/controllers/bluesky/types";
import type { AccountTabPalette } from "@/types/account-tabs";
import { formatTimestampFull } from "@/utils/formatting";
import { EmbeddedPostSnippet } from "./EmbeddedPostSnippet";
import { PostPreview } from "./PostPreview";

type MessagePreviewProps = {
  message: MessagePreviewData;
  palette: AccountTabPalette;
};

function Avatar({ uri, size = 40 }: { uri?: string | null; size?: number }) {
  if (!uri) {
    return (
      <View
        style={[
          styles.avatar,
          styles.avatarPlaceholder,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      />
    );
  }
  return (
    <Image
      key={uri}
      source={{ uri }}
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    />
  );
}

function extractMediaFromEmbed(
  value: Record<string, unknown>,
): MediaAttachment[] {
  const media: MediaAttachment[] = [];

  const embedVal = value.embed as
    | (Record<string, unknown> & {
        images?: unknown;
        playlist?: unknown;
        thumbnail?: unknown;
        alt?: unknown;
        video?: unknown;
      })
    | undefined;

  if (embedVal && typeof embedVal === "object") {
    const images = embedVal.images;
    if (Array.isArray(images)) {
      for (const img of images) {
        if (!img || typeof img !== "object") continue;
        const imgObj = img as Record<string, unknown>;
        const aspect = imgObj.aspectRatio as
          | Record<string, unknown>
          | undefined;
        media.push({
          type: "image",
          thumbUrl: typeof imgObj.thumb === "string" ? imgObj.thumb : undefined,
          fullsizeUrl:
            typeof imgObj.fullsize === "string" ? imgObj.fullsize : undefined,
          alt: typeof imgObj.alt === "string" ? imgObj.alt : undefined,
          width:
            aspect && typeof aspect.width === "number"
              ? aspect.width
              : undefined,
          height:
            aspect && typeof aspect.height === "number"
              ? aspect.height
              : undefined,
        });
      }
    }

    const video = embedVal.video as Record<string, unknown> | undefined;
    let playlist: string | undefined;
    if (video && typeof video.playlist === "string") {
      playlist = video.playlist;
    }
    if (!playlist && typeof embedVal.playlist === "string") {
      playlist = embedVal.playlist;
    }
    if (playlist) {
      const thumbCandidate =
        video && typeof video.thumbnail === "string"
          ? video.thumbnail
          : undefined;
      const thumbFallback =
        typeof embedVal.thumbnail === "string" ? embedVal.thumbnail : undefined;
      const altCandidate =
        video && typeof video.alt === "string" ? video.alt : undefined;
      const altFallback =
        typeof embedVal.alt === "string" ? embedVal.alt : undefined;

      media.push({
        type: "video",
        playlistUrl: playlist,
        thumbUrl: thumbCandidate ?? thumbFallback,
        alt: altCandidate ?? altFallback,
      });
    }
  }

  return media;
}

export function MessagePreview({ message, palette }: MessagePreviewProps) {
  const { sender, embed, recipient } = message;
  const displayName = sender?.displayName || sender?.handle || "Unknown";
  const handle = sender?.handle || "";
  const avatarUrl = sender?.avatarUrl;
  const savedTimestamp: string = message.savedAt;
  const deletedTimestamp: string | null = message.deletedAt ?? null;

  const embeddedPost = useMemo<PostPreviewData | null>(() => {
    if (!embed || typeof embed !== "object") return null;
    const embedObj = embed;
    const record = embedObj.record as Record<string, unknown> | undefined;
    if (
      !record ||
      typeof record !== "object" ||
      typeof record.uri !== "string"
    ) {
      return null;
    }

    const author = record.author as Record<string, unknown> | undefined;
    const value = record.value as Record<string, unknown> | undefined;
    const media = value ? extractMediaFromEmbed(value) : [];

    const post: PostPreviewData = {
      uri: typeof record.uri === "string" ? record.uri : "",
      cid: typeof record.cid === "string" ? record.cid : "",
      text: value && typeof value.text === "string" ? value.text : "",
      createdAt:
        value && typeof value.createdAt === "string"
          ? value.createdAt
          : message.sentAt,
      savedAt: message.sentAt,
      deletedAt: null,
      author: {
        did: author && typeof author.did === "string" ? author.did : "unknown",
        handle:
          author && typeof author.handle === "string"
            ? author.handle
            : "unknown",
        displayName:
          author && typeof author.displayName === "string"
            ? author.displayName
            : null,
        avatarUrl:
          author && typeof author.avatar === "string" ? author.avatar : null,
      },
      media: media.length > 0 ? media : undefined,
    };

    return post;
  }, [embed, message.sentAt]);

  const [postModalVisible, setPostModalVisible] = useState(false);

  const handleLinkPress = useCallback(async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      }
    } catch (err) {
      console.warn("Failed to open URL", url, err);
    }
  }, []);

  const messageNodes = useMemo(() => {
    if (!message.text) return null;

    type Facet = {
      index?: { byteStart?: number; byteEnd?: number };
      features?: { $type?: string; uri?: string }[];
    };

    const facets = Array.isArray(message.facets)
      ? (message.facets as Facet[])
      : [];

    const linkSpans = facets
      .map((facet) => {
        const link = facet.features?.find(
          (f) => f && typeof f === "object" && f.$type?.includes("#link"),
        );
        const byteStart = facet.index?.byteStart ?? null;
        const byteEnd = facet.index?.byteEnd ?? null;
        if (
          !link ||
          typeof link.uri !== "string" ||
          byteStart == null ||
          byteEnd == null
        ) {
          return null;
        }
        return { byteStart, byteEnd, uri: link.uri };
      })
      .filter(
        (span): span is { byteStart: number; byteEnd: number; uri: string } =>
          Boolean(span),
      )
      .sort((a, b) => a.byteStart - b.byteStart);

    // Bluesky facets use byte offsets, not character offsets
    // We need to convert text to bytes for accurate slicing
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const textBytes = encoder.encode(message.text);

    const segments: { text: string; uri?: string }[] = [];
    let byteCursor = 0;
    for (const span of linkSpans) {
      const safeStart = Math.max(0, Math.min(span.byteStart, textBytes.length));
      const safeEnd = Math.max(
        safeStart,
        Math.min(span.byteEnd, textBytes.length),
      );
      if (safeStart > byteCursor) {
        segments.push({
          text: decoder.decode(textBytes.slice(byteCursor, safeStart)),
        });
      }
      segments.push({
        text: decoder.decode(textBytes.slice(safeStart, safeEnd)),
        uri: span.uri,
      });
      byteCursor = safeEnd;
    }
    if (byteCursor < textBytes.length) {
      segments.push({ text: decoder.decode(textBytes.slice(byteCursor)) });
    }

    return segments.map((segment, index) => {
      if (segment.uri) {
        return (
          <Text
            key={`link-${index}`}
            style={[styles.linkText, { color: palette.background }]}
            onPress={() => {
              void handleLinkPress(segment.uri ?? segment.text);
            }}
          >
            {segment.text}
          </Text>
        );
      }
      return (
        <Text key={`text-${index}`} style={{ color: palette.background }}>
          {segment.text}
        </Text>
      );
    });
  }, [handleLinkPress, message.facets, message.text, palette.background]);

  const handleOpenPostModal = useCallback(() => {
    if (embeddedPost) {
      setPostModalVisible(true);
    }
  }, [embeddedPost]);

  const handleClosePostModal = useCallback(() => {
    setPostModalVisible(false);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: palette.card }]}>
      {/* Show recipient (conversation partner) if available */}
      {recipient && (
        <View style={styles.recipientRow}>
          <Text style={[styles.recipientLabel, { color: palette.icon }]}>
            Conversation with
          </Text>
          <View style={styles.recipientInfo}>
            <Avatar uri={recipient.avatarUrl} size={24} />
            <Text
              style={[styles.recipientName, { color: palette.text }]}
              numberOfLines={1}
            >
              {recipient.displayName || recipient.handle}
            </Text>
            <Text
              style={[styles.recipientHandle, { color: palette.icon }]}
              numberOfLines={1}
            >
              @{recipient.handle}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.row}>
        <Avatar uri={avatarUrl} />
        <View style={styles.content}>
          <View style={styles.header}>
            <Text
              style={[styles.displayName, { color: palette.text }]}
              numberOfLines={1}
            >
              {displayName}
            </Text>
            <Text
              style={[styles.handle, { color: palette.icon }]}
              numberOfLines={1}
            >
              @{handle}
            </Text>
          </View>
          <View
            style={[styles.messageBubble, { backgroundColor: palette.tint }]}
          >
            <Text
              style={[styles.messageText, { color: palette.background }]}
              numberOfLines={4}
            >
              {messageNodes}
            </Text>

            {/* Display embedded post if present */}
            {embeddedPost && (
              <EmbeddedPostSnippet
                post={embeddedPost}
                palette={palette}
                onPress={handleOpenPostModal}
              />
            )}
          </View>
        </View>
      </View>

      {message.sentAt && (
        <Text style={[styles.timestampFull, { color: palette.icon }]}>
          Sent {formatTimestampFull(message.sentAt)}
        </Text>
      )}
      <Text style={[styles.timestampFull, { color: palette.icon }]}>
        Saved {formatTimestampFull(savedTimestamp)}
      </Text>
      {deletedTimestamp ? (
        <Text style={[styles.timestampFull, { color: palette.icon }]}>
          Deleted {formatTimestampFull(deletedTimestamp)}
        </Text>
      ) : null}

      {embeddedPost && (
        <Modal
          visible={postModalVisible}
          transparent
          animationType="slide"
          onRequestClose={handleClosePostModal}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: palette.card }]}>
              <Pressable
                style={styles.modalClose}
                onPress={handleClosePostModal}
              >
                <Text style={[styles.modalCloseText, { color: palette.text }]}>
                  ✕ Close
                </Text>
              </Pressable>
              <PostPreview post={embeddedPost} palette={palette} browseMode />
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  avatar: {
    marginRight: 12,
  },
  avatarPlaceholder: {
    backgroundColor: "#555",
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
    marginBottom: 8,
  },
  displayName: {
    fontSize: 15,
    fontWeight: "600",
  },
  handle: {
    fontSize: 14,
  },
  messageBubble: {
    borderRadius: 16,
    borderTopLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  linkText: {
    textDecorationLine: "underline",
  },
  embeddedPost: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  embeddedAuthor: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  embeddedText: {
    fontSize: 14,
    lineHeight: 18,
  },
  embeddedHint: {
    marginTop: 6,
    fontSize: 13,
  },
  recipientRow: {
    marginBottom: 12,
    gap: 4,
  },
  recipientLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
  recipientInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  recipientName: {
    fontSize: 14,
    fontWeight: "600",
  },
  recipientHandle: {
    fontSize: 13,
  },
  timestampFull: {
    fontSize: 13,
    marginTop: 8,
    marginLeft: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "#0008",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    borderRadius: 12,
    padding: 12,
    maxHeight: "90%",
  },
  modalClose: {
    alignSelf: "flex-end",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  modalCloseText: {
    fontSize: 15,
    fontWeight: "600",
  },
});

export default MessagePreview;

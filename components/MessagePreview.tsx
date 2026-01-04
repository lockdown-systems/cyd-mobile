import React, { useCallback, useMemo, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import type {
  AutomationMediaAttachment,
  AutomationMessagePreviewData,
  AutomationPostPreviewData,
} from "@/controllers/bluesky/types";
import type { AccountTabPalette } from "@/types/account-tabs";
import { PostPreview } from "./PostPreview";

function formatTimestampFull(isoString?: string | null): string {
  if (!isoString) return "";
  const date = new Date(isoString);

  // Format: "Jan 4, 2026, 5:19:23 PM"
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

type MessagePreviewProps = {
  message: AutomationMessagePreviewData;
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
      source={{ uri }}
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    />
  );
}

function extractMediaFromEmbed(
  value: Record<string, unknown>
): AutomationMediaAttachment[] {
  const media: AutomationMediaAttachment[] = [];

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
  const { sender, reactions, embed } = message;
  const displayName = sender?.displayName || sender?.handle || "Unknown";
  const handle = sender?.handle || "";
  const avatarUrl = sender?.avatarUrl || sender?.avatarDataURI;

  const embeddedPost = useMemo<AutomationPostPreviewData | null>(() => {
    if (!embed || typeof embed !== "object") return null;
    const embedObj = embed as Record<string, unknown>;
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

    const post: AutomationPostPreviewData = {
      uri: typeof record.uri === "string" ? record.uri : "",
      cid: typeof record.cid === "string" ? record.cid : "",
      text: value && typeof value.text === "string" ? value.text : "",
      createdAt:
        value && typeof value.createdAt === "string"
          ? value.createdAt
          : message.sentAt,
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
        avatarDataURI:
          author && typeof author.avatarDataURI === "string"
            ? author.avatarDataURI
            : null,
      },
      media: media.length > 0 ? media : undefined,
    };

    return post;
  }, [embed, message.sentAt]);

  const [postModalVisible, setPostModalVisible] = useState(false);

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
              {message.text}
            </Text>

            {/* Display embedded post if present */}
            {embeddedPost && (
              <Pressable
                onPress={handleOpenPostModal}
                style={[
                  styles.embeddedPost,
                  {
                    backgroundColor: palette.background,
                    borderColor: palette.icon,
                  },
                ]}
              >
                {embeddedPost.author && (
                  <Text
                    style={[styles.embeddedAuthor, { color: palette.text }]}
                    numberOfLines={1}
                  >
                    {embeddedPost.author.displayName ||
                      embeddedPost.author.handle ||
                      "Unknown"}
                  </Text>
                )}
                {embeddedPost.text && (
                  <Text
                    style={[styles.embeddedText, { color: palette.text }]}
                    numberOfLines={3}
                  >
                    {embeddedPost.text}
                  </Text>
                )}
                <Text style={[styles.embeddedHint, { color: palette.icon }]}>
                  Tap to view full post
                </Text>
              </Pressable>
            )}
          </View>

          {/* Display reactions if present */}
          {reactions && Array.isArray(reactions) && reactions.length > 0 && (
            <View style={styles.reactionsContainer}>
              {reactions.map((reaction: unknown, index: number) => {
                const reactionObj =
                  reaction && typeof reaction === "object"
                    ? (reaction as Record<string, unknown>)
                    : {};
                const sender = reactionObj.sender as
                  | Record<string, unknown>
                  | undefined;
                const value =
                  typeof reactionObj.value === "string"
                    ? reactionObj.value
                    : "";
                const did =
                  sender && typeof sender.did === "string" ? sender.did : index;

                return (
                  <View
                    key={`${did}-${value || index}`}
                    style={[
                      styles.reactionBubble,
                      {
                        backgroundColor: palette.card,
                        borderColor: palette.icon,
                      },
                    ]}
                  >
                    <Text style={styles.reactionEmoji}>{value}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </View>

      {message.sentAt && (
        <Text style={[styles.timestampFull, { color: palette.icon }]}>
          Sent {formatTimestampFull(message.sentAt)}
        </Text>
      )}

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
  reactionsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
    marginLeft: 14,
  },
  reactionBubble: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  reactionEmoji: {
    fontSize: 16,
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

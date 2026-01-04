import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import type { AutomationMessagePreviewData } from "@/controllers/bluesky/types";
import type { AccountTabPalette } from "@/types/account-tabs";

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

export function MessagePreview({ message, palette }: MessagePreviewProps) {
  const { sender, reactions, embed } = message;
  const displayName = sender?.displayName || sender?.handle || "Unknown";
  const handle = sender?.handle || "";
  const avatarUrl = sender?.avatarUrl || sender?.avatarDataURI;

  // Parse embed if it's a record embed (post)
  let embeddedPost: {
    uri?: string;
    author?: { handle?: string; displayName?: string };
    text?: string;
  } | null = null;

  if (embed && typeof embed === "object") {
    const embedObj = embed as Record<string, unknown>;
    const record = embedObj.record as Record<string, unknown> | undefined;
    // Check if this is an AppBskyEmbedRecord.View structure
    if (record && typeof record === "object" && "uri" in record) {
      const author = record.author as Record<string, unknown> | undefined;
      const value = record.value as Record<string, unknown> | undefined;
      embeddedPost = {
        uri: typeof record.uri === "string" ? record.uri : undefined,
        author:
          author && typeof author === "object"
            ? {
                handle:
                  typeof author.handle === "string" ? author.handle : undefined,
                displayName:
                  typeof author.displayName === "string"
                    ? author.displayName
                    : undefined,
              }
            : undefined,
        text:
          value && typeof value === "object" && typeof value.text === "string"
            ? value.text
            : undefined,
      };
    }
  }

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
              <View
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
              </View>
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
});

export default MessagePreview;

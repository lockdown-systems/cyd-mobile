import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import type { AutomationMessagePreviewData } from "@/controllers/bluesky/types";
import type { AccountTabPalette } from "@/types/account-tabs";

function formatTimestamp(isoString?: string | null): string {
  if (!isoString) return "";
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  const { sender } = message;
  const displayName = sender?.displayName || sender?.handle || "Unknown";
  const handle = sender?.handle || "";
  const avatarUrl = sender?.avatarUrl || sender?.avatarDataURI;

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
            {message.sentAt && (
              <Text style={[styles.timestamp, { color: palette.icon }]}>
                · {formatTimestamp(message.sentAt)}
              </Text>
            )}
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
          </View>
        </View>
      </View>
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
  timestamp: {
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
});

export default MessagePreview;

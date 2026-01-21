import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import type { ConversationPreviewData } from "@/controllers/bluesky/types";
import type { AccountTabPalette } from "@/types/account-tabs";
import { formatTimestampFull } from "@/utils/formatting";

type ConversationPreviewProps = {
  conversation: ConversationPreviewData;
  palette: AccountTabPalette;
};

function Avatar({ uri, size = 48 }: { uri?: string | null; size?: number }) {
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

export function ConversationPreview({
  conversation,
  palette,
}: ConversationPreviewProps) {
  // Get the other member(s) - typically just one for DMs
  const otherMembers = conversation.members;
  const primaryMember = otherMembers[0];

  const displayName =
    primaryMember?.displayName || primaryMember?.handle || "Unknown";
  const handle = primaryMember?.handle || "";
  const avatarUrl = primaryMember?.avatarUrl;

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
          </View>
          <Text
            style={[styles.handle, { color: palette.icon }]}
            numberOfLines={1}
          >
            @{handle}
          </Text>
          {conversation.lastMessageText && (
            <Text
              style={[styles.messagePreview, { color: palette.text }]}
              numberOfLines={2}
            >
              {conversation.lastMessageText}
            </Text>
          )}
        </View>
      </View>
      {conversation.muted && (
        <View style={[styles.mutedBadge, { backgroundColor: palette.icon }]}>
          <Text style={styles.mutedText}>Muted</Text>
        </View>
      )}
      {conversation.lastMessageSentAt && (
        <View style={[styles.metdataContainer]}>
          <Text style={[styles.timestamp, { color: palette.icon }]}>
            Sent {formatTimestampFull(conversation.lastMessageSentAt)}
          </Text>
        </View>
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
    gap: 4,
  },
  displayName: {
    fontSize: 16,
    fontWeight: "600",
    flexShrink: 1,
  },
  timestamp: {
    fontSize: 14,
  },
  handle: {
    fontSize: 14,
    marginTop: 2,
  },
  messagePreview: {
    fontSize: 15,
    marginTop: 8,
    lineHeight: 20,
  },
  mutedBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  mutedText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "500",
  },
  metdataContainer: {
    marginTop: 10,
  },
});

export default ConversationPreview;

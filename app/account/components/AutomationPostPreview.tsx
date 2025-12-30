import type { AccountTabPalette } from "@/types/account-tabs";
import React, { type JSX } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

type AutomationPostPreviewProps = {
  post: {
    uri: string;
    cid: string;
    text: string;
    createdAt: string;
    author: {
      did: string;
      handle: string;
      displayName?: string | null;
      avatarUrl?: string | null;
      avatarDataURI?: string | null;
    };
    likeCount?: number | null;
    repostCount?: number | null;
    replyCount?: number | null;
    quoteCount?: number | null;
    isRepost?: boolean;
    quotedPostUri?: string | null;
  };
  palette: AccountTabPalette;
};

function Avatar({ uri }: { uri?: string | null }) {
  if (!uri) {
    return <View style={[styles.avatar, styles.avatarPlaceholder]} />;
  }
  return <Image source={{ uri }} style={styles.avatar} />;
}

export function AutomationPostPreview({
  post,
  palette,
}: AutomationPostPreviewProps): JSX.Element {
  return (
    <View
      style={[
        styles.container,
        { borderColor: palette.icon + "22", backgroundColor: palette.card },
      ]}
    >
      <View style={styles.headerRow}>
        <Avatar
          uri={post.author.avatarDataURI ?? post.author.avatarUrl ?? undefined}
        />
        <View style={styles.headerText}>
          <Text
            style={[styles.displayName, { color: palette.text }]}
            numberOfLines={1}
          >
            {post.author.displayName || post.author.handle}
          </Text>
          <Text
            style={[styles.handle, { color: palette.icon }]}
            numberOfLines={1}
          >
            @{post.author.handle}
          </Text>
        </View>
      </View>
      <Text style={[styles.bodyText, { color: palette.text }]}>
        {post.text}
      </Text>
      <View style={styles.metaRow}>
        <Text style={[styles.meta, { color: palette.icon }]} numberOfLines={1}>
          ❤ {post.likeCount ?? 0} 🔁 {post.repostCount ?? 0} 💬{" "}
          {post.replyCount ?? 0}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerText: {
    flex: 1,
  },
  displayName: {
    fontSize: 15,
    fontWeight: "600",
  },
  handle: {
    fontSize: 13,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#ccc",
  },
  avatarPlaceholder: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#0001",
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  meta: {
    fontSize: 12,
  },
});

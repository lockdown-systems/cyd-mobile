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
    <View style={[styles.container]}>
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
    borderWidth: 0,
    padding: 12,
    gap: 8,
    marginBottom: 50,
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
    fontSize: 18,
    fontWeight: "700",
  },
  handle: {
    fontSize: 15,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ccc",
  },
  avatarPlaceholder: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#0001",
  },
  bodyText: {
    fontSize: 17,
    lineHeight: 24,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    marginTop: 10,
  },
  meta: {
    fontSize: 14,
  },
});

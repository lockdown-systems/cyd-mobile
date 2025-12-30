import type { AutomationPostPreviewData } from "@/controllers/bluesky/types";
import type { AccountTabPalette } from "@/types/account-tabs";
import React, { type JSX } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

type AutomationPostPreviewProps = {
  post: AutomationPostPreviewData;
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
      {post.media && post.media.length > 0 ? (
        <View style={styles.mediaGrid}>
          {post.media.map((item, index) => {
            const key = `${item.type}-${index}`;
            const uri =
              item.localThumbPath ??
              item.thumbUrl ??
              item.localFullsizePath ??
              item.fullsizeUrl ??
              undefined;

            if (item.type === "video") {
              return (
                <View
                  key={key}
                  style={[
                    styles.videoPlaceholder,
                    { borderColor: palette.icon + "33" },
                  ]}
                >
                  <Text style={[styles.videoLabel, { color: palette.text }]}>
                    Video
                  </Text>
                </View>
              );
            }

            if (!uri) {
              return null;
            }

            return (
              <Image key={key} source={{ uri }} style={styles.mediaImage} />
            );
          })}
        </View>
      ) : null}
      <View style={styles.metaRow}>
        <Text style={[styles.meta, { color: palette.icon }]} numberOfLines={1}>
          ❤ {post.likeCount ?? 0} 🔁 {post.repostCount ?? 0} 💬{" "}
          {post.replyCount ?? 0} ❝ {post.quoteCount ?? 0}
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
  mediaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 6,
  },
  mediaImage: {
    width: 120,
    height: 120,
    borderRadius: 10,
    backgroundColor: "#0001",
  },
  videoPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0002",
  },
  videoLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
});

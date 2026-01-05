import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import type { PostPreviewData } from "@/controllers/bluesky/types";
import type { AccountTabPalette } from "@/types/account-tabs";

function toNiceDomain(uri: string): string {
  try {
    const url = new URL(uri);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return uri;
  }
}

type Props = {
  post: PostPreviewData | null | undefined;
  palette: AccountTabPalette;
  onPress?: () => void;
  hint?: string;
};

export function EmbeddedPostSnippet({ post, palette, onPress, hint }: Props) {
  if (!post) return null;

  const Wrapper = onPress ? Pressable : View;

  const handleLinkPress = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      }
    } catch (err) {
      console.warn("Failed to open URL", url, err);
    }
  };

  return (
    <Wrapper
      onPress={onPress}
      style={[
        styles.container,
        {
          backgroundColor: palette.background,
          borderColor: palette.icon,
        },
      ]}
    >
      <Text style={[styles.author, { color: palette.text }]} numberOfLines={1}>
        {post.author?.displayName || post.author?.handle || "Unknown"}
      </Text>
      {!!post.text && (
        <Text style={[styles.text, { color: palette.text }]} numberOfLines={3}>
          {post.text}
        </Text>
      )}
      {post.externalEmbed && (
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            void handleLinkPress(post.externalEmbed!.uri);
          }}
          style={[styles.linkCard, { borderColor: palette.icon }]}
        >
          <Text
            style={[styles.linkDomain, { color: palette.icon }]}
            numberOfLines={1}
          >
            🔗 {toNiceDomain(post.externalEmbed.uri)}
          </Text>
          <Text
            style={[styles.linkTitle, { color: palette.text }]}
            numberOfLines={1}
          >
            {post.externalEmbed.title}
          </Text>
        </Pressable>
      )}
      {hint && (
        <Text style={[styles.hint, { color: palette.icon }]}>{hint}</Text>
      )}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  author: {
    fontSize: 14,
    fontWeight: "600",
  },
  text: {
    fontSize: 14,
    lineHeight: 18,
  },
  hint: {
    fontSize: 13,
  },
  linkCard: {
    marginTop: 4,
    padding: 8,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  linkDomain: {
    fontSize: 12,
  },
  linkTitle: {
    fontSize: 13,
    fontWeight: "500",
  },
});

export default EmbeddedPostSnippet;

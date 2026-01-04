import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { PostPreviewData } from "@/controllers/bluesky/types";
import type { AccountTabPalette } from "@/types/account-tabs";

type Props = {
  post: PostPreviewData | null | undefined;
  palette: AccountTabPalette;
  onPress?: () => void;
  hint?: string;
};

export function EmbeddedPostSnippet({ post, palette, onPress, hint }: Props) {
  if (!post) return null;

  const Wrapper = onPress ? Pressable : View;

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
      <Text style={[styles.hint, { color: palette.icon }]}>
        {hint ?? "Tap to view full post"}
      </Text>
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
});

export default EmbeddedPostSnippet;

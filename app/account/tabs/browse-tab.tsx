import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { AccountTabProps } from "@/types/account-tabs";

type BrowseCategory =
  | "posts"
  | "likes"
  | "bookmarks"
  | "following"
  | "messages";

const CATEGORY_DEFINITIONS: { key: BrowseCategory; label: string }[] = [
  { key: "posts", label: "Posts" },
  { key: "likes", label: "Likes" },
  { key: "bookmarks", label: "Bookmarks" },
  { key: "following", label: "Following" },
  { key: "messages", label: "Messages" },
];

const PLACEHOLDER_COPY: Record<BrowseCategory, (handle: string) => string> = {
  posts: (handle) => `Saved posts for ${handle} will show up here soon.`,
  likes: (handle) => `Likes for ${handle} will show up here soon.`,
  bookmarks: (handle) => `Bookmarks for ${handle} will show up here soon.`,
  following: (handle) => `Following data for ${handle} will show up here soon.`,
  messages: (handle) => `Messages for ${handle} will show up here soon.`,
};

export function BrowseTab({
  accountId: _accountId,
  handle,
  palette,
}: AccountTabProps) {
  const [category, setCategory] = useState<BrowseCategory>("posts");

  const categoryLabel = useMemo(
    () => CATEGORY_DEFINITIONS.find((item) => item.key === category)?.label,
    [category]
  );

  const placeholderMessage = useMemo(
    () => PLACEHOLDER_COPY[category](handle),
    [category, handle]
  );

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <View style={[styles.tabsContainer, { borderColor: palette.icon }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsContent}
          bounces
        >
          {CATEGORY_DEFINITIONS.map((item) => {
            const selected = item.key === category;
            return (
              <Pressable
                key={item.key}
                onPress={() => setCategory(item.key)}
                style={[
                  styles.tabButton,
                  {
                    borderColor: palette.icon,
                    backgroundColor: palette.card,
                  },
                  selected && {
                    backgroundColor: palette.tint,
                    borderColor: palette.tint,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tabLabel,
                    { color: palette.icon },
                    selected && { color: palette.background },
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={[styles.card, { backgroundColor: palette.card }]}>
        <Text style={[styles.cardTitle, { color: palette.text }]}>
          {categoryLabel}
        </Text>
        <Text style={[styles.cardBody, { color: palette.icon }]}>
          {placeholderMessage}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabsContainer: {
    marginBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 12,
  },
  tabsContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    gap: 8,
  },
  tabButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  card: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 6,
  },
  cardBody: {
    fontSize: 15,
    lineHeight: 22,
  },
});

export default BrowseTab;

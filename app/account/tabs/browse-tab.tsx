import { useMemo, useState, type ComponentType } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { AccountTabPalette, AccountTabProps } from "@/types/account-tabs";

import { BrowseBookmarks } from "./browse/BrowseBookmarks";
import { BrowseFollowing } from "./browse/BrowseFollowing";
import { BrowseLikes } from "./browse/BrowseLikes";
import { BrowseMessages } from "./browse/BrowseMessages";
import { BrowsePosts } from "./browse/BrowsePosts";

type BrowseCategory =
  | "posts"
  | "likes"
  | "bookmarks"
  | "following"
  | "messages";

type CategoryComponentProps = {
  handle: string;
  palette: AccountTabPalette;
  accountId?: number;
};

type CategoryComponent = ComponentType<CategoryComponentProps>;

const CATEGORY_DEFINITIONS: { key: BrowseCategory; label: string }[] = [
  { key: "posts", label: "Posts" },
  { key: "likes", label: "Likes" },
  { key: "bookmarks", label: "Bookmarks" },
  { key: "following", label: "Following" },
  { key: "messages", label: "Messages" },
];

const CATEGORY_COMPONENTS: Record<BrowseCategory, CategoryComponent> = {
  posts: BrowsePosts,
  likes: BrowseLikes,
  bookmarks: BrowseBookmarks,
  following: BrowseFollowing,
  messages: BrowseMessages,
};

export function BrowseTab({ accountId, handle, palette }: AccountTabProps) {
  const [category, setCategory] = useState<BrowseCategory>("posts");

  const ActiveCategory = useMemo(
    () => CATEGORY_COMPONENTS[category],
    [category]
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

      <ActiveCategory handle={handle} palette={palette} accountId={accountId} />
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
});

export default BrowseTab;

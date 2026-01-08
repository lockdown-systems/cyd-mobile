import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { AccountTabPalette, AccountTabProps } from "@/types/account-tabs";

import { BrowseBookmarks } from "./browse/BrowseBookmarks";
import { BrowseLikes } from "./browse/BrowseLikes";
import { BrowseMessages } from "./browse/BrowseMessages";
import { BrowsePosts } from "./browse/BrowsePosts";
import { BrowseReposts } from "./browse/BrowseReposts";

type BrowseCategory = "posts" | "reposts" | "likes" | "bookmarks" | "messages";

type CategoryComponentProps = {
  handle: string;
  palette: AccountTabPalette;
  accountId?: number;
  onCountChange?: (count: number, label: string) => void;
  onHeaderChange?: (
    header: {
      visible: boolean;
      title: string;
      onBack: () => void;
    } | null
  ) => void;
};

type CategoryComponent = ComponentType<CategoryComponentProps>;

const CATEGORY_DEFINITIONS: { key: BrowseCategory; label: string }[] = [
  { key: "posts", label: "Posts" },
  { key: "reposts", label: "Reposts" },
  { key: "likes", label: "Likes" },
  { key: "bookmarks", label: "Bookmarks" },
  { key: "messages", label: "Messages" },
];

const CATEGORY_COMPONENTS: Record<BrowseCategory, CategoryComponent> = {
  posts: BrowsePosts,
  reposts: BrowseReposts,
  likes: BrowseLikes,
  bookmarks: BrowseBookmarks,
  messages: BrowseMessages,
};

export function BrowseTab({ accountId, handle, palette }: AccountTabProps) {
  const [category, setCategory] = useState<BrowseCategory>("posts");
  const [countLabel, setCountLabel] = useState<string>("");
  const [conversationHeader, setConversationHeader] = useState<{
    visible: boolean;
    title: string;
    onBack: () => void;
  } | null>(null);

  const handleCountChange = useCallback((newCount: number, label: string) => {
    setCountLabel(label);
  }, []);

  const handleHeaderChange = useCallback(
    (
      header: { visible: boolean; title: string; onBack: () => void } | null
    ) => {
      setConversationHeader(header);
    },
    []
  );

  // Reset count label and header when switching tabs
  useEffect(() => {
    setCountLabel("");
    setConversationHeader(null);
  }, [category]);

  const ActiveCategory = useMemo(
    () => CATEGORY_COMPONENTS[category],
    [category]
  );

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <View style={[styles.tabsContainer]}>
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

      {conversationHeader && (
        <View
          style={[
            styles.conversationHeader,
            {
              backgroundColor: palette.background,
              borderBottomColor: palette.icon,
            },
          ]}
        >
          <Pressable onPress={conversationHeader.onBack}>
            <Text style={[styles.backText, { color: palette.tint }]}>
              ◀ Back
            </Text>
          </Pressable>
          <Text style={[styles.conversationTitle, { color: palette.text }]}>
            {conversationHeader.title}
          </Text>
        </View>
      )}

      {countLabel && (
        <View style={[styles.countBar]}>
          <Text style={[styles.countText, { color: palette.icon }]}>
            {countLabel}
          </Text>
        </View>
      )}

      <ActiveCategory
        handle={handle}
        palette={palette}
        accountId={accountId}
        onCountChange={handleCountChange}
        onHeaderChange={handleHeaderChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  countBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  countText: {
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
  },
  tabsContainer: {
    marginBottom: 0,
    paddingBottom: 12,
  },
  conversationHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backText: {
    fontSize: 16,
    fontWeight: "600",
  },
  conversationTitle: {
    fontSize: 17,
    fontWeight: "700",
    flexShrink: 1,
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

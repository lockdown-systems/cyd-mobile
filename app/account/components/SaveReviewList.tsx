import { MaterialIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { AccountTabPalette } from "@/types/account-tabs";

const SAVE_OPTION_DEFINITIONS = [
  {
    key: "posts",
    label: "Save my posts and reposts",
    reviewLabel: "Save posts and reposts",
  },
  {
    key: "likes",
    label: "Save my likes",
    reviewLabel: "Save likes",
  },
  {
    key: "bookmarks",
    label: "Save my bookmarks",
    reviewLabel: "Save bookmarks",
  },
  {
    key: "chat",
    label: "Save my chat messages",
    reviewLabel: "Save chat messages",
  },
] as const;

export type SaveOptionKey = (typeof SAVE_OPTION_DEFINITIONS)[number]["key"];
export type SaveOptionState = Record<SaveOptionKey, boolean>;

export { SAVE_OPTION_DEFINITIONS };

type SaveReviewListProps = {
  selections: SaveOptionState;
  palette: AccountTabPalette;
};

export function SaveReviewList({ selections, palette }: SaveReviewListProps) {
  const chosen = SAVE_OPTION_DEFINITIONS.filter(
    (option) => selections[option.key]
  );

  if (chosen.length === 0) {
    return (
      <Text style={[styles.emptyText, { color: palette.icon }]}>
        No data selected for saving.
      </Text>
    );
  }

  return (
    <View style={styles.list}>
      {chosen.map((option) => (
        <View key={option.key} style={styles.reviewRow}>
          <MaterialIcons
            name="check-circle"
            size={20}
            color={palette.tint}
            style={styles.reviewIcon}
          />
          <Text style={[styles.reviewLabel, { color: palette.text }]}>
            {option.reviewLabel}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
  },
  reviewRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 4,
  },
  reviewIcon: {
    marginTop: 2,
  },
  reviewLabel: {
    fontSize: 15,
    lineHeight: 22,
    flex: 1,
  },
  emptyText: {
    fontSize: 15,
    fontStyle: "italic",
  },
});

export default SaveReviewList;

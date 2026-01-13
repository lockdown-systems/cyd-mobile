import { MaterialIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { AccountDeleteSettings } from "@/database/delete-settings";
import type { AccountTabPalette } from "@/types/account-tabs";

type DeleteReviewListProps = {
  selections: AccountDeleteSettings;
  palette: AccountTabPalette;
};

export function DeleteReviewList({
  selections,
  palette,
}: DeleteReviewListProps) {
  const chosen: string[] = [];

  if (selections.deletePosts) {
    const hasAgeFilter = selections.deletePostsDaysOldEnabled;
    const conditions: string[] = [];
    if (selections.deletePostsLikesThresholdEnabled) {
      conditions.push(`${selections.deletePostsLikesThreshold} likes`);
    }
    if (selections.deletePostsRepostsThresholdEnabled) {
      conditions.push(`${selections.deletePostsRepostsThreshold} reposts`);
    }

    let message =
      hasAgeFilter || conditions.length > 0
        ? "Delete posts"
        : "Delete all posts";

    if (hasAgeFilter) {
      message += ` older than ${selections.deletePostsDaysOld} days`;
    }

    if (conditions.length > 0) {
      message += ` unless they have at least ${conditions.join(" or ")}`;
    }

    if (selections.deletePostsPreserveThreads && conditions.length > 0) {
      message += ", preserving entire threads";
    }

    chosen.push(message);
  }

  if (selections.deleteReposts) {
    let message = selections.deleteRepostsDaysOldEnabled
      ? "Delete reposts"
      : "Delete all reposts";
    if (selections.deleteRepostsDaysOldEnabled) {
      message += ` older than ${selections.deleteRepostsDaysOld} days`;
    }
    chosen.push(message);
  }

  if (selections.deleteLikes) {
    let message = selections.deleteLikesDaysOldEnabled
      ? "Delete likes"
      : "Delete all likes";
    if (selections.deleteLikesDaysOldEnabled) {
      message += ` older than ${selections.deleteLikesDaysOld} days`;
    }
    chosen.push(message);
  }

  if (selections.deleteBookmarks) {
    chosen.push("Delete all bookmarks");
  }

  if (selections.deleteChats) {
    let message = selections.deleteChatsDaysOldEnabled
      ? "Delete chat messages"
      : "Delete all chat messages";
    if (selections.deleteChatsDaysOldEnabled) {
      message += ` older than ${selections.deleteChatsDaysOld} days`;
    }
    chosen.push(message);
  }

  if (selections.deleteUnfollowEveryone) {
    chosen.push("Unfollow everyone");
  }

  if (chosen.length === 0) {
    return (
      <Text style={[styles.emptyText, { color: palette.icon }]}>
        No data selected for deletion.
      </Text>
    );
  }

  return (
    <View style={styles.list}>
      {chosen.map((label) => (
        <View key={label} style={styles.reviewRow}>
          <MaterialIcons
            name="check-circle"
            size={20}
            color={palette.tint}
            style={styles.reviewIcon}
          />
          <Text style={[styles.reviewLabel, { color: palette.text }]}>
            {label}
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

export default DeleteReviewList;

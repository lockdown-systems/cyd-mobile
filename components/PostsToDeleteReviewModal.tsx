import { MaterialIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PostPreview } from "@/components/PostPreview";
import { BlueskyAccountController } from "@/controllers";
import type { PostToDeletePreview } from "@/controllers/bluesky/deletion-calculator";
import type { PostPreviewData } from "@/controllers/bluesky/types";
import type { AccountDeleteSettings } from "@/database/delete-settings";
import type { AccountTabPalette } from "@/types/account-tabs";

type PostsToDeleteReviewModalProps = {
  visible: boolean;
  onClose: () => void;
  accountId: number;
  accountUUID: string;
  palette: AccountTabPalette;
  selections: AccountDeleteSettings;
};

export function PostsToDeleteReviewModal({
  visible,
  onClose,
  accountId,
  accountUUID,
  palette,
  selections,
}: PostsToDeleteReviewModalProps) {
  const [postsToDelete, setPostsToDelete] = useState<PostPreviewData[]>([]);
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<BlueskyAccountController | null>(null);

  // Helper to map PostToDeletePreview to PostPreviewData
  const mapToPreviewData = useCallback(
    (post: PostToDeletePreview): PostPreviewData => ({
      uri: post.uri,
      cid: post.cid,
      text: post.text,
      createdAt: post.createdAt,
      savedAt: new Date(post.savedAt).toISOString(),
      preserve: post.preserve,
      author: {
        did: post.authorDid,
        handle: post.authorHandle ?? "unknown",
        displayName: post.authorDisplayName,
        avatarUrl: post.avatarUrl,
        avatarDataURI: post.avatarDataURI,
      },
      likeCount: post.likeCount,
      repostCount: post.repostCount,
      replyCount: post.replyCount,
      quoteCount: post.quoteCount,
      isReply: post.isReply,
      isRepost: false,
    }),
    []
  );

  // Load posts when modal becomes visible
  useEffect(() => {
    if (!visible) return;

    async function loadPosts() {
      setLoading(true);
      try {
        const controller = new BlueskyAccountController(accountId, accountUUID);
        await controller.initDB();
        await controller.initAgent();
        controllerRef.current = controller;
        const posts = controller.getPostsForDeletionReview(selections);
        setPostsToDelete(posts.map(mapToPreviewData));
      } catch (err) {
        console.error("Failed to load posts to delete:", err);
      } finally {
        setLoading(false);
      }
    }

    void loadPosts();
  }, [visible, accountId, accountUUID, selections, mapToPreviewData]);

  // Handle preserve toggle - toggle the value and update local state
  const handlePreserveToggle = useCallback(
    (postUri: string) => {
      const controller = controllerRef.current;
      if (!controller) return;

      // Find the current preserve state
      const post = postsToDelete.find((p) => p.uri === postUri);
      if (!post) return;

      const newPreserveState = !post.preserve;

      try {
        controller.setPostPreserve(postUri, newPreserveState);
        // Update local state to reflect the change
        setPostsToDelete((prev) =>
          prev.map((p) =>
            p.uri === postUri ? { ...p, preserve: newPreserveState } : p
          )
        );
      } catch (err) {
        console.error("Failed to toggle preserve:", err);
      }
    },
    [postsToDelete]
  );

  // Handle close
  const handleClose = useCallback(() => {
    setPostsToDelete([]);
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { backgroundColor: palette.background }]}>
        <View style={[styles.header, { borderColor: palette.icon + "22" }]}>
          <Pressable
            onPress={handleClose}
            style={styles.closeButton}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <MaterialIcons name="close" size={24} color={palette.text} />
          </Pressable>
          <Text style={[styles.title, { color: palette.text }]}>
            Review Posts to Delete
          </Text>
          <View style={styles.closeButton} />
        </View>
        <Text style={[styles.subtitle, { color: palette.icon }]}>
          {'Toggle "Preserve" to keep or delete each post'}
        </Text>
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={palette.tint} />
          </View>
        ) : (
          <FlatList
            data={postsToDelete}
            keyExtractor={(item) => item.uri}
            renderItem={({ item }) => (
              <PostPreview
                post={item}
                palette={palette}
                browseMode={true}
                onPreserveToggle={handlePreserveToggle}
              />
            )}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={[styles.emptyText, { color: palette.icon }]}>
                No posts to delete
              </Text>
            }
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    padding: 16,
    gap: 12,
  },
  emptyText: {
    fontSize: 16,
    textAlign: "center",
    paddingVertical: 32,
  },
});

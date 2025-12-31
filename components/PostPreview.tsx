import React, { useCallback, useRef, useState, type JSX } from "react";
import {
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import type { AutomationPostPreviewData } from "@/controllers/bluesky/types";
import type { AccountTabPalette } from "@/types/account-tabs";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

function formatNumber(num: number | null | undefined): string {
  if (num == null) return "0";
  return num.toLocaleString();
}

type PostPreviewProps = {
  post: AutomationPostPreviewData;
  palette: AccountTabPalette;
  browseMode?: boolean;
};

type ImageItem = {
  uri: string;
  index: number;
};

function Avatar({ uri }: { uri?: string | null }) {
  if (!uri) {
    return <View style={[styles.avatar, styles.avatarPlaceholder]} />;
  }
  return <Image source={{ uri }} style={styles.avatar} />;
}

function ImageGalleryModal({
  visible,
  images,
  initialIndex,
  onClose,
}: {
  visible: boolean;
  images: ImageItem[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const flatListRef = useRef<FlatList<ImageItem>>(null);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = event.nativeEvent.contentOffset.x;
      const newIndex = Math.round(offsetX / SCREEN_WIDTH);
      if (
        newIndex !== currentIndex &&
        newIndex >= 0 &&
        newIndex < images.length
      ) {
        setCurrentIndex(newIndex);
      }
    },
    [currentIndex, images.length]
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ImageItem>) => (
      <Pressable style={styles.modalImageContainer} onPress={onClose}>
        <Image
          source={{ uri: item.uri }}
          style={styles.modalImage}
          resizeMode="contain"
        />
      </Pressable>
    ),
    [onClose]
  );

  const keyExtractor = useCallback((item: ImageItem) => `${item.index}`, []);

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: SCREEN_WIDTH,
      offset: SCREEN_WIDTH * index,
      index,
    }),
    []
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.modalBackdrop}>
        <Pressable style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeButtonText}>✕</Text>
        </Pressable>

        <FlatList
          ref={flatListRef}
          data={images}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={getItemLayout}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        />

        {images.length > 1 && (
          <View style={styles.pagination}>
            <Text style={styles.paginationText}>
              {currentIndex + 1} / {images.length}
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

export function PostPreview({
  post,
  palette,
  browseMode = false,
}: PostPreviewProps): JSX.Element {
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  // Build gallery images list for browse mode
  const galleryImages: ImageItem[] = React.useMemo(() => {
    if (!browseMode || !post.media) return [];
    return post.media
      .filter((item) => item.type === "image")
      .map((item, index) => ({
        uri:
          item.localFullsizePath ??
          item.fullsizeUrl ??
          item.localThumbPath ??
          item.thumbUrl ??
          "",
        index,
      }))
      .filter((item) => item.uri !== "");
  }, [browseMode, post.media]);

  const openGallery = useCallback((index: number) => {
    setGalleryIndex(index);
    setGalleryVisible(true);
  }, []);

  const closeGallery = useCallback(() => {
    setGalleryVisible(false);
  }, []);

  return (
    <View
      style={[
        styles.container,
        { borderColor: palette.icon + "22", backgroundColor: palette.card },
      ]}
    >
      {browseMode && galleryImages.length > 0 && (
        <ImageGalleryModal
          visible={galleryVisible}
          images={galleryImages}
          initialIndex={galleryIndex}
          onClose={closeGallery}
        />
      )}

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

            // In browse mode, make images tappable
            if (browseMode) {
              // Find the gallery index for this image
              const galleryIdx = galleryImages.findIndex(
                (g) =>
                  g.uri ===
                  (item.localFullsizePath ??
                    item.fullsizeUrl ??
                    item.localThumbPath ??
                    item.thumbUrl)
              );

              return (
                <Pressable
                  key={key}
                  onPress={() => openGallery(galleryIdx >= 0 ? galleryIdx : 0)}
                >
                  <Image source={{ uri }} style={styles.mediaImage} />
                </Pressable>
              );
            }

            return (
              <Image key={key} source={{ uri }} style={styles.mediaImage} />
            );
          })}
        </View>
      ) : null}
      <View style={styles.metaRow}>
        <Text style={[styles.meta, { color: palette.icon }]} numberOfLines={1}>
          ❤ {formatNumber(post.likeCount)} 🔁 {formatNumber(post.repostCount)} ❝{" "}
          {formatNumber(post.quoteCount)} 💬 {formatNumber(post.replyCount)}
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
  // Modal styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalImageContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: "center",
    alignItems: "center",
  },
  modalImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
  },
  closeButton: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  closeButtonText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "600",
  },
  pagination: {
    position: "absolute",
    bottom: 60,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    borderRadius: 16,
  },
  paginationText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
  },
});

export default PostPreview;

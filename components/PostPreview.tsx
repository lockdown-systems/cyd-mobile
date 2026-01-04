import { useVideoPlayer, VideoView } from "expo-video";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import {
  Dimensions,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import type {
  ExternalEmbed,
  MediaAttachment,
  PostPreviewData,
} from "@/controllers/bluesky/types";
import type { AccountTabPalette } from "@/types/account-tabs";
import { EmbeddedPostSnippet } from "./EmbeddedPostSnippet";

import { formatNumber, formatTimestampFull } from "@/utils/formatting";
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

type PostPreviewProps = {
  post: PostPreviewData;
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

function VideoPlayerModal({
  visible,
  videoUri,
  posterUri,
  onClose,
}: {
  visible: boolean;
  videoUri: string;
  posterUri?: string;
  onClose: () => void;
}) {
  const player = useVideoPlayer(videoUri, (p) => {
    p.loop = false;
  });

  // Auto-play when modal becomes visible, pause when hidden
  useEffect(() => {
    if (visible) {
      player.play();
    } else {
      player.pause();
    }
  }, [visible, player]);

  const handleClose = useCallback(() => {
    player.pause();
    onClose();
  }, [onClose, player]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.modalBackdrop}>
        <Pressable style={styles.closeButton} onPress={handleClose}>
          <Text style={styles.closeButtonText}>✕</Text>
        </Pressable>

        <View style={styles.videoContainer}>
          <VideoView
            player={player}
            style={styles.videoPlayer}
            nativeControls
            contentFit="contain"
          />
        </View>
      </View>
    </Modal>
  );
}

function toNiceDomain(url: string): string {
  try {
    const host = new URL(url).host;
    // Strip www. prefix if present
    return host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ExternalEmbedCard({
  embed,
  palette,
}: {
  embed: ExternalEmbed;
  palette: AccountTabPalette;
}) {
  const handlePress = useCallback(() => {
    void (async () => {
      try {
        const supported = await Linking.canOpenURL(embed.uri);
        if (supported) {
          await Linking.openURL(embed.uri);
        }
      } catch (err) {
        console.warn("Failed to open URL", embed.uri, err);
      }
    })();
  }, [embed.uri]);

  const thumbUri = embed.thumbLocalPath ?? embed.thumbUrl;

  return (
    <Pressable
      style={[
        styles.externalCard,
        {
          borderColor: palette.icon + "44",
          backgroundColor: palette.background,
        },
      ]}
      onPress={handlePress}
    >
      {thumbUri && (
        <Image
          source={{ uri: thumbUri }}
          style={styles.externalThumb}
          resizeMode="cover"
        />
      )}
      <View style={styles.externalContent}>
        <Text
          style={[styles.externalDomain, { color: palette.icon }]}
          numberOfLines={1}
        >
          🔗 {toNiceDomain(embed.uri)}
        </Text>
        <Text
          style={[styles.externalTitle, { color: palette.text }]}
          numberOfLines={2}
        >
          {embed.title}
        </Text>
        {embed.description ? (
          <Text
            style={[styles.externalDescription, { color: palette.icon }]}
            numberOfLines={2}
          >
            {embed.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
export function PostPreview({
  post,
  palette,
  browseMode = false,
}: PostPreviewProps): JSX.Element {
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [videoVisible, setVideoVisible] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<MediaAttachment | null>(
    null
  );
  const [quotedModalVisible, setQuotedModalVisible] = useState(false);

  const handleLinkPress = useCallback(async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      }
    } catch (err) {
      console.warn("Failed to open URL", url, err);
    }
  }, []);

  // Parse facets to render links
  const textNodes = useMemo(() => {
    if (!post.text) return null;

    type Facet = {
      index?: { byteStart?: number; byteEnd?: number };
      features?: { $type?: string; uri?: string; did?: string }[];
    };

    const facets = Array.isArray(post.facets) ? (post.facets as Facet[]) : [];

    type SpanItem = {
      start: number;
      end: number;
      type: "link" | "mention";
      uri?: string;
    };

    // Collect all link/mention spans
    const spans: SpanItem[] = facets
      .map((facet): SpanItem | null => {
        const link = facet.features?.find(
          (f) => f && typeof f === "object" && f.$type?.includes("#link")
        );
        const mention = facet.features?.find(
          (f) => f && typeof f === "object" && f.$type?.includes("#mention")
        );
        const start = facet.index?.byteStart ?? null;
        const end = facet.index?.byteEnd ?? null;

        if (start == null || end == null) return null;

        if (link && typeof link.uri === "string") {
          return { start, end, type: "link", uri: link.uri };
        }
        if (mention && typeof mention.did === "string") {
          return { start, end, type: "mention" };
        }
        return null;
      })
      .filter((span): span is SpanItem => span !== null)
      .sort((a, b) => a.start - b.start);

    if (spans.length === 0) {
      return <Text style={{ color: palette.text }}>{post.text}</Text>;
    }

    const segments: {
      text: string;
      type?: "link" | "mention";
      uri?: string;
    }[] = [];
    let cursor = 0;
    for (const span of spans) {
      const safeStart = Math.max(0, Math.min(span.start, post.text.length));
      const safeEnd = Math.max(safeStart, Math.min(span.end, post.text.length));

      if (safeStart > cursor) {
        segments.push({ text: post.text.slice(cursor, safeStart) });
      }
      segments.push({
        text: post.text.slice(safeStart, safeEnd),
        type: span.type,
        uri: span.type === "link" ? span.uri : undefined,
      });
      cursor = safeEnd;
    }
    if (cursor < post.text.length) {
      segments.push({ text: post.text.slice(cursor) });
    }

    return segments.map((segment, index) => {
      if (segment.type === "link" && segment.uri) {
        return (
          <Text
            key={`link-${index}`}
            style={[styles.linkText, { color: palette.tint }]}
            onPress={() => {
              void handleLinkPress(segment.uri ?? segment.text);
            }}
          >
            {segment.text}
          </Text>
        );
      }
      if (segment.type === "mention") {
        return (
          <Text
            key={`mention-${index}`}
            style={[styles.linkText, { color: palette.tint }]}
          >
            {segment.text}
          </Text>
        );
      }
      return (
        <Text key={`text-${index}`} style={{ color: palette.text }}>
          {segment.text}
        </Text>
      );
    });
  }, [handleLinkPress, post.facets, post.text, palette.text, palette.tint]);

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

  const openVideo = useCallback((video: MediaAttachment) => {
    setCurrentVideo(video);
    setVideoVisible(true);
  }, []);

  const closeVideo = useCallback(() => {
    setVideoVisible(false);
    setCurrentVideo(null);
  }, []);

  const handleOpenQuoted = useCallback(() => {
    if (post.quotedPost) {
      setQuotedModalVisible(true);
    }
  }, [post.quotedPost]);

  const handleCloseQuoted = useCallback(() => {
    setQuotedModalVisible(false);
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

      {browseMode && currentVideo && currentVideo.playlistUrl && (
        <VideoPlayerModal
          visible={videoVisible}
          videoUri={String(currentVideo.playlistUrl)}
          posterUri={
            currentVideo.localThumbPath ?? currentVideo.thumbUrl ?? undefined
          }
          onClose={closeVideo}
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
            ellipsizeMode="tail"
          >
            {post.author.displayName || post.author.handle}
          </Text>
          <View style={styles.handleRow}>
            <Text
              style={[styles.handle, { color: palette.icon }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              @{post.author.handle}
            </Text>
          </View>
        </View>
      </View>
      <Text style={[styles.bodyText, { color: palette.text }]}>
        {textNodes}
      </Text>

      {/* External embed (link preview) */}
      {post.externalEmbed && (
        <ExternalEmbedCard embed={post.externalEmbed} palette={palette} />
      )}

      {post.quotedPost && (
        <EmbeddedPostSnippet
          post={post.quotedPost}
          palette={palette}
          onPress={handleOpenQuoted}
        />
      )}
      {post.media && post.media.length > 0 ? (
        <View style={styles.mediaGrid}>
          {post.media.map((item, index) => {
            const key = `${item.type}-${index}`;
            const thumbUri = item.localThumbPath ?? item.thumbUrl ?? undefined;

            if (item.type === "video") {
              const hasPlaylistUrl = !!item.playlistUrl;

              // In browse mode with a playlist URL, make it tappable to play
              if (browseMode && hasPlaylistUrl) {
                return (
                  <Pressable
                    key={key}
                    onPress={() => openVideo(item)}
                    style={styles.videoWrapper}
                  >
                    {thumbUri ? (
                      <Image
                        source={{ uri: thumbUri }}
                        style={styles.mediaImage}
                      />
                    ) : (
                      <View
                        style={[
                          styles.videoPlaceholder,
                          { borderColor: palette.icon + "33" },
                        ]}
                      />
                    )}
                    <View style={styles.playButtonOverlay}>
                      <View style={styles.playButton}>
                        <Text style={styles.playButtonText}>▶</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              }

              // Non-browse mode or no playlist URL - show thumbnail with video indicator
              return (
                <View key={key} style={styles.videoWrapper}>
                  {thumbUri ? (
                    <Image
                      source={{ uri: thumbUri }}
                      style={styles.mediaImage}
                    />
                  ) : (
                    <View
                      style={[
                        styles.videoPlaceholder,
                        { borderColor: palette.icon + "33" },
                      ]}
                    />
                  )}
                  <View style={styles.videoIndicator}>
                    <Text style={styles.videoIndicatorText}>Video</Text>
                  </View>
                </View>
              );
            }

            const uri =
              thumbUri ??
              item.localFullsizePath ??
              item.fullsizeUrl ??
              undefined;

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
      <Text style={[styles.timestampFull, { color: palette.icon }]}>
        Posted {formatTimestampFull(post.createdAt)}
      </Text>

      {post.quotedPost && (
        <Modal
          visible={quotedModalVisible}
          transparent
          animationType="slide"
          onRequestClose={handleCloseQuoted}
        >
          <View style={styles.modalBackdropLight}>
            <View style={[styles.modalCard, { backgroundColor: palette.card }]}>
              <Pressable style={styles.modalClose} onPress={handleCloseQuoted}>
                <Text style={[styles.modalCloseText, { color: palette.text }]}>
                  ✕ Close
                </Text>
              </Pressable>
              <PostPreview
                post={post.quotedPost}
                palette={palette}
                browseMode
              />
            </View>
          </View>
        </Modal>
      )}
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
  handleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
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
  timestampFull: {
    fontSize: 13,
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
  videoWrapper: {
    position: "relative",
    width: 120,
    height: 120,
  },
  playButtonOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  playButtonText: {
    color: "#fff",
    fontSize: 18,
    marginLeft: 3,
  },
  videoIndicator: {
    position: "absolute",
    bottom: 6,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    borderRadius: 4,
  },
  videoIndicatorText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  videoContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.6,
    justifyContent: "center",
    alignItems: "center",
  },
  videoPlayer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.6,
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
  modalBackdropLight: {
    flex: 1,
    backgroundColor: "#0008",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    borderRadius: 12,
    padding: 12,
    maxHeight: "90%",
  },
  modalClose: {
    alignSelf: "flex-end",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  modalCloseText: {
    fontSize: 15,
    fontWeight: "600",
  },
  // External embed (link preview) styles
  externalCard: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
    marginTop: 8,
  },
  externalThumb: {
    width: "100%",
    aspectRatio: 1200 / 630,
    backgroundColor: "#0001",
  },
  externalContent: {
    padding: 12,
    gap: 4,
  },
  externalDomain: {
    fontSize: 13,
  },
  externalTitle: {
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
  },
  externalDescription: {
    fontSize: 14,
    lineHeight: 19,
  },
  // Facet link styles
  linkText: {
    textDecorationLine: "underline",
  },
});

export default PostPreview;

import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { PostPreview } from "@/components/PostPreview";
import { buildAccountPaths } from "@/controllers/BaseAccountController";
import type {
  ExternalEmbed,
  MediaAttachment,
  PostPreviewData,
} from "@/controllers/bluesky/types";
import { getDatabase } from "@/database";
import type { AccountTabPalette } from "@/types/account-tabs";
import { extractEmbeddedPostFromJson } from "@/utils/embeddedPost";

export type BrowseProps = {
  handle: string;
  palette: AccountTabPalette;
  accountId?: number;
};

export type AccountMeta = {
  uuid: string;
  did: string | null;
  handle: string;
};

export type PostRow = {
  id: number;
  uri: string;
  cid: string;
  authorDid: string;
  text: string;
  createdAt: string;
  facetsJSON: string | null;
  embedJSON: string | null;
  quotedPostUri: string | null;
  likeCount: number | null;
  repostCount: number | null;
  replyCount: number | null;
  quoteCount: number | null;
  isRepost: number;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  avatarDataURI: string | null;
};

export type MediaRow = {
  postUri: string;
  position: number;
  mediaType: "image" | "video";
  alt: string | null;
  width: number | null;
  height: number | null;
  thumbUrl: string | null;
  fullsizeUrl: string | null;
  playlistUrl: string | null;
  localThumbPath: string | null;
  localFullsizePath: string | null;
  localVideoPath: string | null;
};

export type ExternalRow = {
  postUri: string;
  uri: string;
  title: string;
  description: string | null;
  thumbUrl: string | null;
  thumbLocalPath: string | null;
};

export type Cursor = {
  createdAt: string;
  id: number;
};

export const PAGE_SIZE = 25;

export async function fetchAccountMeta(
  accountId: number
): Promise<AccountMeta | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<AccountMeta & { handle: string }>(
    `SELECT a.uuid, b.did, b.handle
     FROM account a
     INNER JOIN bsky_account b ON b.id = a.bskyAccountID
     WHERE a.id = ?
     LIMIT 1;`,
    [accountId]
  );

  if (!row) return null;
  return {
    uuid: row.uuid,
    did: row.did,
    handle: row.handle,
  };
}

function parseFacets(facetsJSON: string | null): unknown[] | null {
  if (!facetsJSON) return null;
  try {
    const parsed: unknown = JSON.parse(facetsJSON);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function mapRowToPreview(
  row: PostRow,
  fallbackHandle: string,
  media?: MediaAttachment[],
  externalEmbed?: ExternalEmbed | null
): PostPreviewData {
  const quotedPost = extractEmbeddedPostFromJson(row.embedJSON, row.createdAt);
  const facets = parseFacets(row.facetsJSON);

  return {
    uri: row.uri,
    cid: row.cid,
    text: row.text ?? "",
    createdAt: row.createdAt,
    author: {
      did: row.authorDid,
      handle: row.handle ?? fallbackHandle,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl ?? undefined,
      avatarDataURI: row.avatarDataURI ?? undefined,
    },
    likeCount: row.likeCount,
    repostCount: row.repostCount,
    replyCount: row.replyCount,
    quoteCount: row.quoteCount,
    isRepost: row.isRepost === 1,
    quotedPostUri: row.quotedPostUri,
    quotedPost,
    media,
    facets,
    externalEmbed,
  };
}

function mapMediaRowToAttachment(row: MediaRow): MediaAttachment {
  return {
    type: row.mediaType,
    alt: row.alt,
    width: row.width,
    height: row.height,
    thumbUrl: row.thumbUrl,
    fullsizeUrl: row.fullsizeUrl,
    playlistUrl: row.playlistUrl,
    localThumbPath: row.localThumbPath,
    localFullsizePath: row.localFullsizePath,
    localVideoPath: row.localVideoPath,
  };
}

export async function fetchMediaForPosts(
  db: SQLiteDatabase,
  postUris: string[]
): Promise<Map<string, MediaAttachment[]>> {
  if (postUris.length === 0) {
    return new Map();
  }

  const placeholders = postUris.map(() => "?").join(",");
  const mediaRows = await db.getAllAsync<MediaRow>(
    `SELECT postUri, position, mediaType, alt, width, height,
            thumbUrl, fullsizeUrl, playlistUrl, localThumbPath, localFullsizePath, localVideoPath
     FROM post_media
     WHERE postUri IN (${placeholders})
     ORDER BY postUri, position;`,
    postUris
  );

  const mediaMap = new Map<string, MediaAttachment[]>();
  for (const row of mediaRows) {
    const existing = mediaMap.get(row.postUri) ?? [];
    existing.push(mapMediaRowToAttachment(row));
    mediaMap.set(row.postUri, existing);
  }

  return mediaMap;
}

export async function fetchExternalEmbedsForPosts(
  db: SQLiteDatabase,
  postUris: string[]
): Promise<Map<string, ExternalEmbed>> {
  if (postUris.length === 0) {
    return new Map();
  }

  const placeholders = postUris.map(() => "?").join(",");
  const externalRows = await db.getAllAsync<ExternalRow>(
    `SELECT postUri, uri, title, description, thumbUrl, thumbLocalPath
     FROM post_external
     WHERE postUri IN (${placeholders});`,
    postUris
  );

  const externalMap = new Map<string, ExternalEmbed>();
  for (const row of externalRows) {
    externalMap.set(row.postUri, {
      uri: row.uri,
      title: row.title,
      description: row.description,
      thumbUrl: row.thumbUrl,
      thumbLocalPath: row.thumbLocalPath,
    });
  }

  return externalMap;
}

export async function openAccountDb(uuid: string): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync(
    buildAccountPaths("bluesky", uuid).dbPathForSQLite
  );
  await db.execAsync("PRAGMA foreign_keys = ON;");
  return db;
}

/**
 * Query builders for different browse types
 */
export type BrowseType = "posts" | "likes" | "bookmarks";

export function buildFirstPageQuery(type: BrowseType): string {
  const baseSelect = `
    SELECT
      p.id, p.uri, p.cid, p.authorDid, p.text, p.createdAt,
      p.facetsJSON, p.embedJSON, p.quotedPostUri,
      p.likeCount, p.repostCount, p.replyCount, p.quoteCount, p.isRepost,
      prof.handle, prof.displayName, prof.avatarUrl, prof.avatarDataURI
    FROM post p
    LEFT JOIN profile prof ON prof.did = p.authorDid`;

  switch (type) {
    case "posts":
      return `${baseSelect}
        WHERE p.authorDid = ?
        ORDER BY p.createdAt DESC, p.id DESC
        LIMIT ?;`;
    case "likes":
      return `${baseSelect}
        WHERE p.viewerLiked = 1
        ORDER BY p.createdAt DESC, p.id DESC
        LIMIT ?;`;
    case "bookmarks":
      return `${baseSelect}
        WHERE p.viewerBookmarked = 1
        ORDER BY p.createdAt DESC, p.id DESC
        LIMIT ?;`;
  }
}

export function buildLoadMoreQuery(type: BrowseType): string {
  const baseSelect = `
    SELECT
      p.id, p.uri, p.cid, p.authorDid, p.text, p.createdAt,
      p.facetsJSON, p.embedJSON, p.quotedPostUri,
      p.likeCount, p.repostCount, p.replyCount, p.quoteCount, p.isRepost,
      prof.handle, prof.displayName, prof.avatarUrl, prof.avatarDataURI
    FROM post p
    LEFT JOIN profile prof ON prof.did = p.authorDid`;

  switch (type) {
    case "posts":
      return `${baseSelect}
        WHERE p.authorDid = ? AND (p.createdAt < ? OR (p.createdAt = ? AND p.id < ?))
        ORDER BY p.createdAt DESC, p.id DESC
        LIMIT ?;`;
    case "likes":
      return `${baseSelect}
        WHERE p.viewerLiked = 1 AND (p.createdAt < ? OR (p.createdAt = ? AND p.id < ?))
        ORDER BY p.createdAt DESC, p.id DESC
        LIMIT ?;`;
    case "bookmarks":
      return `${baseSelect}
        WHERE p.viewerBookmarked = 1 AND (p.createdAt < ? OR (p.createdAt = ? AND p.id < ?))
        ORDER BY p.createdAt DESC, p.id DESC
        LIMIT ?;`;
  }
}

export function getFirstPageParams(
  type: BrowseType,
  did: string
): (string | number)[] {
  switch (type) {
    case "posts":
      return [did, PAGE_SIZE];
    case "likes":
    case "bookmarks":
      return [PAGE_SIZE];
  }
}

export function getLoadMoreParams(
  type: BrowseType,
  did: string,
  cursor: Cursor
): (string | number)[] {
  switch (type) {
    case "posts":
      return [did, cursor.createdAt, cursor.createdAt, cursor.id, PAGE_SIZE];
    case "likes":
    case "bookmarks":
      return [cursor.createdAt, cursor.createdAt, cursor.id, PAGE_SIZE];
  }
}

export function getEmptyMessage(type: BrowseType, hasFilter: boolean): string {
  if (hasFilter) {
    return "No posts match your filter.";
  }
  switch (type) {
    case "posts":
      return "No posts saved yet.";
    case "likes":
      return "No liked posts saved yet.";
    case "bookmarks":
      return "No bookmarked posts saved yet.";
  }
}

/**
 * Shared browse component that can display posts, likes, or bookmarks
 */
export function BrowseList({
  handle,
  palette,
  accountId,
  type,
}: BrowseProps & { type: BrowseType }) {
  const [posts, setPosts] = useState<PostPreviewData[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef<Cursor | null>(null);
  const accountDbRef = useRef<SQLiteDatabase | null>(null);
  const metaRef = useRef<AccountMeta | null>(null);

  const loadFirstPage = useCallback(async () => {
    if (!accountId) {
      setError("Missing account");
      setLoadingInitial(false);
      return;
    }

    setLoadingInitial(true);
    setError(null);
    setHasMore(true);
    setPosts([]);
    cursorRef.current = null;

    try {
      const meta = await fetchAccountMeta(accountId);
      if (!meta) {
        setError("Account not found");
        setHasMore(false);
        return;
      }
      metaRef.current = meta;

      if (!meta.did) {
        setError("Missing DID for account");
        setHasMore(false);
        return;
      }

      const db = await openAccountDb(meta.uuid);
      accountDbRef.current = db;

      const query = buildFirstPageQuery(type);
      const params = getFirstPageParams(type, meta.did);
      const rows = await db.getAllAsync<PostRow>(query, params);

      // Fetch media and external embeds for these posts
      const postUris = rows.map((r) => r.uri);
      const [mediaMap, externalMap] = await Promise.all([
        fetchMediaForPosts(db, postUris),
        fetchExternalEmbedsForPosts(db, postUris),
      ]);

      const mapped = rows.map((row) =>
        mapRowToPreview(
          row,
          meta.handle ?? handle,
          mediaMap.get(row.uri),
          externalMap.get(row.uri) ?? null
        )
      );
      setPosts(mapped);
      setHasMore(rows.length === PAGE_SIZE);
      const last = rows[rows.length - 1] ?? null;
      cursorRef.current = last
        ? { createdAt: last.createdAt, id: last.id }
        : null;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setHasMore(false);
    } finally {
      setLoadingInitial(false);
    }
  }, [accountId, handle, type]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loadingInitial || !hasMore) {
      return;
    }

    const db = accountDbRef.current;
    const meta = metaRef.current;
    const cursor = cursorRef.current;

    if (!db || !meta?.did || !cursor) {
      return;
    }

    setLoadingMore(true);
    try {
      const query = buildLoadMoreQuery(type);
      const params = getLoadMoreParams(type, meta.did, cursor);
      const rows = await db.getAllAsync<PostRow>(query, params);

      // Fetch media and external embeds for these posts
      const postUris = rows.map((r) => r.uri);
      const [mediaMap, externalMap] = await Promise.all([
        fetchMediaForPosts(db, postUris),
        fetchExternalEmbedsForPosts(db, postUris),
      ]);

      const mapped = rows.map((row) =>
        mapRowToPreview(
          row,
          meta.handle ?? handle,
          mediaMap.get(row.uri),
          externalMap.get(row.uri) ?? null
        )
      );
      setPosts((prev) => [...prev, ...mapped]);
      setHasMore(rows.length === PAGE_SIZE);
      const last = rows[rows.length - 1] ?? null;
      cursorRef.current = last
        ? { createdAt: last.createdAt, id: last.id }
        : cursorRef.current;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [handle, hasMore, loadingInitial, loadingMore, type]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  // Filter posts based on filter text (case insensitive)
  const filteredPosts = useMemo(() => {
    if (!filterText.trim()) {
      return posts;
    }
    const searchTerm = filterText.toLowerCase();
    return posts.filter(
      (post) =>
        post.text?.toLowerCase().includes(searchTerm) ||
        post.author?.handle?.toLowerCase().includes(searchTerm) ||
        post.author?.displayName?.toLowerCase().includes(searchTerm)
    );
  }, [posts, filterText]);

  const renderItem = useCallback(
    ({ item }: { item: PostPreviewData }) => (
      <PostPreview post={item} palette={palette} browseMode />
    ),
    [palette]
  );

  const keyExtractor = useCallback((item: PostPreviewData) => item.uri, []);

  const handleEndReached = useCallback(() => {
    void loadMore();
  }, [loadMore]);

  if (loadingInitial) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.tint} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <Text style={{ color: palette.text }}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <FlatList
        data={filteredPosts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.listContent,
          filteredPosts.length === 0 && styles.listEmpty,
        ]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={() => (
          <Text style={[styles.emptyText, { color: palette.icon }]}>
            {getEmptyMessage(type, filterText.trim().length > 0)}
          </Text>
        )}
        onEndReachedThreshold={0.3}
        onEndReached={handleEndReached}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator color={palette.tint} />
            </View>
          ) : null
        }
      />
      <View
        style={[
          styles.filterBar,
          { backgroundColor: palette.background, borderTopColor: palette.icon },
        ]}
      >
        <TextInput
          style={[
            styles.filterInput,
            {
              backgroundColor: palette.background,
              color: palette.text,
              borderColor: palette.icon,
            },
          ]}
          placeholder="Filter posts..."
          placeholderTextColor={palette.icon}
          value={filterText}
          onChangeText={setFilterText}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    padding: 12,
    gap: 12,
  },
  listEmpty: {
    flexGrow: 1,
    justifyContent: "center",
  },
  separator: {
    height: 4,
  },
  footer: {
    paddingVertical: 12,
  },
  emptyText: {
    textAlign: "center",
    fontSize: 15,
  },
  filterBar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterInput: {
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 15,
  },
});

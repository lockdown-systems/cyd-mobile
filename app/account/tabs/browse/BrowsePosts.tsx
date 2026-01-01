import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PostPreview } from "@/components/PostPreview";
import { buildAccountPaths } from "@/controllers/BaseAccountController";
import type {
  AutomationMediaAttachment,
  AutomationPostPreviewData,
} from "@/controllers/bluesky/types";
import { getDatabase } from "@/database";
import type { AccountTabPalette } from "@/types/account-tabs";

type Props = {
  handle: string;
  palette: AccountTabPalette;
  accountId?: number;
};

type AccountMeta = {
  uuid: string;
  did: string | null;
  handle: string;
};

type PostRow = {
  id: number;
  uri: string;
  cid: string;
  authorDid: string;
  text: string;
  createdAt: string;
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

type MediaRow = {
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

type Cursor = {
  createdAt: string;
  id: number;
};

const PAGE_SIZE = 25;

async function fetchAccountMeta(
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

function mapRowToPreview(
  row: PostRow,
  fallbackHandle: string,
  media?: AutomationMediaAttachment[]
): AutomationPostPreviewData {
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
    media,
  };
}

function mapMediaRowToAttachment(row: MediaRow): AutomationMediaAttachment {
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

async function fetchMediaForPosts(
  db: SQLiteDatabase,
  postUris: string[]
): Promise<Map<string, AutomationMediaAttachment[]>> {
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

  const mediaMap = new Map<string, AutomationMediaAttachment[]>();
  for (const row of mediaRows) {
    const existing = mediaMap.get(row.postUri) ?? [];
    existing.push(mapMediaRowToAttachment(row));
    mediaMap.set(row.postUri, existing);
  }

  return mediaMap;
}

export function BrowsePosts({ handle, palette, accountId }: Props) {
  const [posts, setPosts] = useState<AutomationPostPreviewData[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
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

      const db = await openDatabaseAsync(
        buildAccountPaths("bluesky", meta.uuid).dbPathForSQLite
      );
      await db.execAsync("PRAGMA foreign_keys = ON;");
      accountDbRef.current = db;

      const rows = await db.getAllAsync<PostRow>(
        `SELECT
           p.id, p.uri, p.cid, p.authorDid, p.text, p.createdAt,
           p.likeCount, p.repostCount, p.replyCount, p.quoteCount, p.isRepost,
           prof.handle, prof.displayName, prof.avatarUrl, prof.avatarDataURI
         FROM post p
         LEFT JOIN profile prof ON prof.did = p.authorDid
         WHERE p.authorDid = ?
         ORDER BY p.createdAt DESC, p.id DESC
         LIMIT ?;`,
        [meta.did, PAGE_SIZE]
      );

      // Fetch media for these posts
      const postUris = rows.map((r) => r.uri);
      const mediaMap = await fetchMediaForPosts(db, postUris);

      const mapped = rows.map((row) =>
        mapRowToPreview(row, meta.handle ?? handle, mediaMap.get(row.uri))
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
  }, [accountId, handle]);

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
      const rows = await db.getAllAsync<PostRow>(
        `SELECT
           p.id, p.uri, p.cid, p.authorDid, p.text, p.createdAt,
           p.likeCount, p.repostCount, p.replyCount, p.quoteCount, p.isRepost,
           prof.handle, prof.displayName, prof.avatarUrl, prof.avatarDataURI
         FROM post p
         LEFT JOIN profile prof ON prof.did = p.authorDid
         WHERE p.authorDid = ? AND (p.createdAt < ? OR (p.createdAt = ? AND p.id < ?))
         ORDER BY p.createdAt DESC, p.id DESC
         LIMIT ?;`,
        [meta.did, cursor.createdAt, cursor.createdAt, cursor.id, PAGE_SIZE]
      );

      // Fetch media for these posts
      const postUris = rows.map((r) => r.uri);
      const mediaMap = await fetchMediaForPosts(db, postUris);

      const mapped = rows.map((row) =>
        mapRowToPreview(row, meta.handle ?? handle, mediaMap.get(row.uri))
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
  }, [handle, hasMore, loadingInitial, loadingMore]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const renderItem = useCallback(
    ({ item }: { item: AutomationPostPreviewData }) => (
      <PostPreview post={item} palette={palette} browseMode />
    ),
    [palette]
  );

  const keyExtractor = useCallback(
    (item: AutomationPostPreviewData) => item.uri,
    []
  );

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
    <FlatList
      data={posts}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={[
        styles.listContent,
        { backgroundColor: palette.background },
        posts.length === 0 && styles.listEmpty,
      ]}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={() => (
        <Text style={[styles.emptyText, { color: palette.icon }]}>
          No posts saved yet.
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
  );
}

const styles = StyleSheet.create({
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
});

export default BrowsePosts;

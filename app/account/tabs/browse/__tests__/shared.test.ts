/**
 * @fileoverview Tests for browse tab shared helper functions
 */

import type {
  ExternalEmbed,
  MediaAttachment,
} from "@/controllers/bluesky/types";
import { createMockDatabase } from "@/testUtils/mockDatabase";
import type { SQLiteDatabase } from "expo-sqlite";
import {
  buildFirstPageQuery,
  buildLoadMoreQuery,
  fetchExternalEmbedsForPosts,
  fetchMediaForPosts,
  mapRowToPreview,
  type BrowseType,
  type ExternalRow,
  type MediaRow,
  type PostRow,
} from "../shared";

// Type for embedded record structure
interface MockEmbedRecord {
  uri?: string;
  cid?: string;
  value?: { text?: string; createdAt?: string };
  author?: {
    did?: string;
    handle?: string;
    displayName?: string;
    avatar?: string;
  };
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  quoteCount?: number;
}

interface MockEmbed {
  record?: MockEmbedRecord;
}

// Mock the embeddedPost utility
jest.mock("@/utils/embeddedPost", () => ({
  extractEmbeddedPostFromJson: jest.fn((embedJson: string | null) => {
    if (!embedJson) return null;
    try {
      const embed = JSON.parse(embedJson) as MockEmbed;
      if (embed.record) {
        const record = embed.record;
        return {
          uri: record.uri ?? "",
          cid: record.cid ?? "",
          text: record.value?.text ?? "",
          createdAt: record.value?.createdAt ?? "",
          author: {
            did: record.author?.did ?? "unknown",
            handle: record.author?.handle ?? "unknown",
            displayName: record.author?.displayName ?? null,
            avatarUrl: record.author?.avatar ?? null,
          },
          likeCount: record.likeCount ?? null,
          repostCount: record.repostCount ?? null,
          replyCount: record.replyCount ?? null,
          quoteCount: record.quoteCount ?? null,
        };
      }
      return null;
    } catch {
      return null;
    }
  }),
}));

describe("shared browse helpers", () => {
  describe("mapRowToPreview", () => {
    const fallbackHandle = "default.handle";

    const baseRow: PostRow = {
      id: 1,
      uri: "at://did:plc:author123/app.bsky.feed.post/abc123",
      cid: "bafyreicid123",
      authorDid: "did:plc:author123",
      text: "This is a test post",
      createdAt: "2024-01-15T10:00:00.000Z",
      facetsJSON: null,
      embedJSON: null,
      quotedPostUri: null,
      likeCount: 100,
      repostCount: 50,
      replyCount: 25,
      quoteCount: 10,
      isRepost: 0,
      handle: "author.bsky.social",
      displayName: "Test Author",
      avatarUrl: "https://cdn.bsky.app/avatar.jpg",
    };

    it("should map basic post row to preview data", () => {
      const result = mapRowToPreview(baseRow, fallbackHandle);

      expect(result).toMatchObject({
        uri: "at://did:plc:author123/app.bsky.feed.post/abc123",
        cid: "bafyreicid123",
        text: "This is a test post",
        createdAt: "2024-01-15T10:00:00.000Z",
        author: {
          did: "did:plc:author123",
          handle: "author.bsky.social",
          displayName: "Test Author",
          avatarUrl: "https://cdn.bsky.app/avatar.jpg",
        },
        likeCount: 100,
        repostCount: 50,
        replyCount: 25,
        quoteCount: 10,
        isRepost: false,
      });
    });

    it("should use fallback handle when row handle is null", () => {
      const row: PostRow = {
        ...baseRow,
        handle: null,
      };

      const result = mapRowToPreview(row, fallbackHandle);

      expect(result.author.handle).toBe(fallbackHandle);
    });

    it("should set isRepost to true when isRepost column is 1", () => {
      const row: PostRow = {
        ...baseRow,
        isRepost: 1,
      };

      const result = mapRowToPreview(row, fallbackHandle);

      expect(result.isRepost).toBe(true);
    });

    it("should parse facetsJSON correctly", () => {
      const facets = [
        {
          index: { byteStart: 0, byteEnd: 10 },
          features: [
            {
              $type: "app.bsky.richtext.facet#mention",
              did: "did:plc:mentioned",
            },
          ],
        },
      ];

      const row: PostRow = {
        ...baseRow,
        facetsJSON: JSON.stringify(facets),
      };

      const result = mapRowToPreview(row, fallbackHandle);

      expect(result.facets).toEqual(facets);
    });

    it("should return null facets for invalid JSON", () => {
      const row: PostRow = {
        ...baseRow,
        facetsJSON: "{invalid json",
      };

      const result = mapRowToPreview(row, fallbackHandle);

      expect(result.facets).toBeNull();
    });

    it("should return null facets when facetsJSON is null", () => {
      const result = mapRowToPreview(baseRow, fallbackHandle);

      expect(result.facets).toBeNull();
    });

    it("should include media attachments when provided", () => {
      const media: MediaAttachment[] = [
        {
          type: "image",
          thumbUrl: "https://cdn.bsky.app/thumb1.jpg",
          fullsizeUrl: "https://cdn.bsky.app/full1.jpg",
          alt: "Image 1",
        },
        {
          type: "image",
          thumbUrl: "https://cdn.bsky.app/thumb2.jpg",
          fullsizeUrl: "https://cdn.bsky.app/full2.jpg",
          alt: "Image 2",
        },
      ];

      const result = mapRowToPreview(baseRow, fallbackHandle, media);

      expect(result.media).toEqual(media);
    });

    it("should include external embed when provided", () => {
      const externalEmbed: ExternalEmbed = {
        uri: "https://example.com/article",
        title: "Great Article",
        description: "An interesting read",
        thumbUrl: "https://example.com/thumb.jpg",
      };

      const result = mapRowToPreview(
        baseRow,
        fallbackHandle,
        undefined,
        externalEmbed
      );

      expect(result.externalEmbed).toEqual(externalEmbed);
    });

    it("should extract quoted post from embedJSON", () => {
      const embedJson = JSON.stringify({
        record: {
          uri: "at://did:plc:quoted/app.bsky.feed.post/quoted123",
          cid: "bafyreiquoted",
          author: { did: "did:plc:quoted", handle: "quoted.bsky.social" },
          value: { text: "Quoted post content" },
        },
      });

      const row: PostRow = {
        ...baseRow,
        embedJSON: embedJson,
        quotedPostUri: "at://did:plc:quoted/app.bsky.feed.post/quoted123",
      };

      const result = mapRowToPreview(row, fallbackHandle);

      expect(result.quotedPost).not.toBeNull();
      expect(result.quotedPost?.text).toBe("Quoted post content");
      expect(result.quotedPostUri).toBe(
        "at://did:plc:quoted/app.bsky.feed.post/quoted123"
      );
    });

    it("should apply quotedPostExternalEmbed to quoted post", () => {
      const embedJson = JSON.stringify({
        record: {
          uri: "at://did:plc:quoted/app.bsky.feed.post/quoted123",
          author: { did: "did:plc:quoted", handle: "quoted.bsky.social" },
          value: { text: "Quoted with link" },
        },
      });

      const quotedPostExternalEmbed: ExternalEmbed = {
        uri: "https://example.com/quoted-link",
        title: "Link in Quoted Post",
        description: "Description of linked content",
        thumbUrl: "https://example.com/quoted-thumb.jpg",
      };

      const row: PostRow = {
        ...baseRow,
        embedJSON: embedJson,
        quotedPostUri: "at://did:plc:quoted/app.bsky.feed.post/quoted123",
      };

      const result = mapRowToPreview(
        row,
        fallbackHandle,
        undefined,
        undefined,
        quotedPostExternalEmbed
      );

      expect(result.quotedPost?.externalEmbed).toEqual(quotedPostExternalEmbed);
    });

    it("should handle null engagement counts", () => {
      const row: PostRow = {
        ...baseRow,
        likeCount: null,
        repostCount: null,
        replyCount: null,
        quoteCount: null,
      };

      const result = mapRowToPreview(row, fallbackHandle);

      expect(result.likeCount).toBeNull();
      expect(result.repostCount).toBeNull();
      expect(result.replyCount).toBeNull();
      expect(result.quoteCount).toBeNull();
    });

    it("should handle null avatarUrl", () => {
      const row: PostRow = {
        ...baseRow,
        avatarUrl: null,
      };

      const result = mapRowToPreview(row, fallbackHandle);

      expect(result.author.avatarUrl).toBeUndefined();
    });
  });

  describe("fetchMediaForPosts", () => {
    let mockDb: SQLiteDatabase;

    beforeEach(() => {
      mockDb = createMockDatabase();
    });

    it("should return empty map for empty postUris array", async () => {
      const result = await fetchMediaForPosts(mockDb, []);

      expect(result.size).toBe(0);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(jest.mocked(mockDb.getAllAsync)).not.toHaveBeenCalled();
    });

    it("should fetch and group media by postUri", async () => {
      const mediaRows: MediaRow[] = [
        {
          postUri: "at://did/post/1",
          position: 0,
          mediaType: "image",
          alt: "First image",
          width: 1920,
          height: 1080,
          thumbUrl: "https://cdn.bsky.app/thumb1.jpg",
          fullsizeUrl: "https://cdn.bsky.app/full1.jpg",
          playlistUrl: null,
        },
        {
          postUri: "at://did/post/1",
          position: 1,
          mediaType: "image",
          alt: "Second image",
          width: 1080,
          height: 1080,
          thumbUrl: "https://cdn.bsky.app/thumb2.jpg",
          fullsizeUrl: "https://cdn.bsky.app/full2.jpg",
          playlistUrl: null,
        },
        {
          postUri: "at://did/post/2",
          position: 0,
          mediaType: "video",
          alt: "Video",
          width: null,
          height: null,
          thumbUrl: "https://cdn.bsky.app/video-thumb.jpg",
          fullsizeUrl: null,
          playlistUrl: "https://video.bsky.app/playlist.m3u8",
        },
      ];

      (mockDb.getAllAsync as jest.Mock).mockResolvedValue(mediaRows);

      const result = await fetchMediaForPosts(mockDb, [
        "at://did/post/1",
        "at://did/post/2",
      ]);

      expect(result.size).toBe(2);
      expect(result.get("at://did/post/1")).toHaveLength(2);
      expect(result.get("at://did/post/2")).toHaveLength(1);

      const post1Media = result.get("at://did/post/1");
      expect(post1Media?.[0].type).toBe("image");
      expect(post1Media?.[0].alt).toBe("First image");
      expect(post1Media?.[1].alt).toBe("Second image");

      const post2Media = result.get("at://did/post/2");
      expect(post2Media?.[0].type).toBe("video");
      expect(post2Media?.[0].playlistUrl).toBe(
        "https://video.bsky.app/playlist.m3u8"
      );
    });

    it("should return empty map when no media found", async () => {
      (mockDb.getAllAsync as jest.Mock).mockResolvedValue([]);

      const result = await fetchMediaForPosts(mockDb, ["at://did/post/1"]);

      expect(result.size).toBe(0);
    });
  });

  describe("fetchExternalEmbedsForPosts", () => {
    let mockDb: SQLiteDatabase;

    beforeEach(() => {
      mockDb = createMockDatabase();
    });

    it("should return empty map for empty postUris array", async () => {
      const result = await fetchExternalEmbedsForPosts(mockDb, []);

      expect(result.size).toBe(0);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(jest.mocked(mockDb.getAllAsync)).not.toHaveBeenCalled();
    });

    it("should fetch and map external embeds by postUri", async () => {
      const externalRows: ExternalRow[] = [
        {
          postUri: "at://did/post/1",
          uri: "https://example.com/article1",
          title: "Article 1",
          description: "Description 1",
          thumbUrl: "https://example.com/thumb1.jpg",
          thumbLocalPath: "/local/thumb1.jpg",
        },
        {
          postUri: "at://did/post/2",
          uri: "https://example.com/article2",
          title: "Article 2",
          description: null,
          thumbUrl: null,
          thumbLocalPath: null,
        },
      ];

      (mockDb.getAllAsync as jest.Mock).mockResolvedValue(externalRows);

      const result = await fetchExternalEmbedsForPosts(mockDb, [
        "at://did/post/1",
        "at://did/post/2",
      ]);

      expect(result.size).toBe(2);

      const embed1 = result.get("at://did/post/1");
      expect(embed1).toEqual({
        uri: "https://example.com/article1",
        title: "Article 1",
        description: "Description 1",
        thumbUrl: "https://example.com/thumb1.jpg",
        thumbLocalPath: "/local/thumb1.jpg",
      });

      const embed2 = result.get("at://did/post/2");
      expect(embed2).toEqual({
        uri: "https://example.com/article2",
        title: "Article 2",
        description: null,
        thumbUrl: null,
        thumbLocalPath: null,
      });
    });

    it("should return empty map when no external embeds found", async () => {
      (mockDb.getAllAsync as jest.Mock).mockResolvedValue([]);

      const result = await fetchExternalEmbedsForPosts(mockDb, [
        "at://did/post/1",
      ]);

      expect(result.size).toBe(0);
    });
  });

  describe("buildFirstPageQuery", () => {
    it("should build posts query with authorDid filter", () => {
      const query = buildFirstPageQuery("posts");

      expect(query).toContain("FROM post p");
      expect(query).toContain("LEFT JOIN profile prof");
      expect(query).toContain("WHERE p.authorDid = ?");
      expect(query).toContain("ORDER BY p.createdAt DESC");
      expect(query).toContain("LIMIT ?");
    });

    it("should build likes query with viewerLiked filter", () => {
      const query = buildFirstPageQuery("likes");

      expect(query).toContain("WHERE p.viewerLiked = 1");
      expect(query).not.toContain("p.authorDid = ?");
    });

    it("should build bookmarks query with viewerBookmarked filter", () => {
      const query = buildFirstPageQuery("bookmarks");

      expect(query).toContain("WHERE p.viewerBookmarked = 1");
      expect(query).not.toContain("p.authorDid = ?");
    });

    it("should select all required fields", () => {
      const types: BrowseType[] = ["posts", "likes", "bookmarks"];

      for (const type of types) {
        const query = buildFirstPageQuery(type);

        expect(query).toContain("p.id");
        expect(query).toContain("p.uri");
        expect(query).toContain("p.cid");
        expect(query).toContain("p.authorDid");
        expect(query).toContain("p.text");
        expect(query).toContain("p.createdAt");
        expect(query).toContain("p.facetsJSON");
        expect(query).toContain("p.embedJSON");
        expect(query).toContain("p.quotedPostUri");
        expect(query).toContain("p.likeCount");
        expect(query).toContain("p.repostCount");
        expect(query).toContain("p.replyCount");
        expect(query).toContain("p.quoteCount");
        expect(query).toContain("p.isRepost");
        expect(query).toContain("prof.handle");
        expect(query).toContain("prof.displayName");
        expect(query).toContain("prof.avatarUrl");
      }
    });
  });

  describe("buildLoadMoreQuery", () => {
    it("should build posts load more query with cursor pagination", () => {
      const query = buildLoadMoreQuery("posts");

      expect(query).toContain("WHERE p.authorDid = ?");
      expect(query).toContain(
        "(p.createdAt < ? OR (p.createdAt = ? AND p.id < ?))"
      );
      expect(query).toContain("ORDER BY p.createdAt DESC, p.id DESC");
    });

    it("should build likes load more query with cursor pagination", () => {
      const query = buildLoadMoreQuery("likes");

      expect(query).toContain("WHERE p.viewerLiked = 1");
      expect(query).toContain(
        "(p.createdAt < ? OR (p.createdAt = ? AND p.id < ?))"
      );
    });

    it("should build bookmarks load more query with cursor pagination", () => {
      const query = buildLoadMoreQuery("bookmarks");

      expect(query).toContain("WHERE p.viewerBookmarked = 1");
      expect(query).toContain(
        "(p.createdAt < ? OR (p.createdAt = ? AND p.id < ?))"
      );
    });
  });
});

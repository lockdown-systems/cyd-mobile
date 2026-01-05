/**
 * @fileoverview Tests for embeddedPost utility functions
 */

import {
  extractEmbeddedPost,
  extractEmbeddedPostFromJson,
  extractMediaFromEmbeddedRecord,
} from "../embeddedPost";

describe("embeddedPost", () => {
  describe("extractEmbeddedPost", () => {
    const fallbackCreatedAt = "2024-01-15T10:00:00.000Z";

    it("should return null for null embed", () => {
      expect(extractEmbeddedPost(null, fallbackCreatedAt)).toBeNull();
    });

    it("should return null for undefined embed", () => {
      expect(extractEmbeddedPost(undefined, fallbackCreatedAt)).toBeNull();
    });

    it("should return null for non-object embed", () => {
      expect(extractEmbeddedPost("string", fallbackCreatedAt)).toBeNull();
      expect(extractEmbeddedPost(123, fallbackCreatedAt)).toBeNull();
    });

    it("should return null for embed without record", () => {
      expect(extractEmbeddedPost({}, fallbackCreatedAt)).toBeNull();
      expect(
        extractEmbeddedPost({ something: "else" }, fallbackCreatedAt)
      ).toBeNull();
    });

    it("should return null for record without URI", () => {
      const embed = {
        record: {
          value: { text: "Some text" },
        },
      };
      expect(extractEmbeddedPost(embed, fallbackCreatedAt)).toBeNull();
    });

    it("should extract basic quoted post", () => {
      const embed = {
        record: {
          uri: "at://did:plc:author123/app.bsky.feed.post/post123",
          cid: "bafyreicid123",
          author: {
            did: "did:plc:author123",
            handle: "author.bsky.social",
            displayName: "Test Author",
            avatar: "https://cdn.bsky.app/avatar.jpg",
          },
          value: {
            text: "This is a quoted post",
            createdAt: "2024-01-14T09:00:00.000Z",
          },
          indexedAt: "2024-01-14T09:00:01.000Z",
        },
      };

      const result = extractEmbeddedPost(embed, fallbackCreatedAt);

      expect(result).not.toBeNull();
      expect(result?.uri).toBe(
        "at://did:plc:author123/app.bsky.feed.post/post123"
      );
      expect(result?.cid).toBe("bafyreicid123");
      expect(result?.text).toBe("This is a quoted post");
      expect(result?.createdAt).toBe("2024-01-14T09:00:00.000Z");
      expect(result?.author.did).toBe("did:plc:author123");
      expect(result?.author.handle).toBe("author.bsky.social");
      expect(result?.author.displayName).toBe("Test Author");
      expect(result?.author.avatarUrl).toBe("https://cdn.bsky.app/avatar.jpg");
    });

    it("should use fallback createdAt when not in value", () => {
      const embed = {
        record: {
          uri: "at://did:plc:author123/app.bsky.feed.post/post123",
          cid: "bafyreicid123",
          author: { did: "did:plc:author123", handle: "author.bsky.social" },
          value: {
            text: "Post without createdAt",
          },
        },
      };

      const result = extractEmbeddedPost(embed, fallbackCreatedAt);

      expect(result?.createdAt).toBe(fallbackCreatedAt);
    });

    it("should extract engagement counts", () => {
      const embed = {
        record: {
          uri: "at://did:plc:author123/app.bsky.feed.post/post123",
          author: { did: "did:plc:author123", handle: "author.bsky.social" },
          value: { text: "Popular post" },
          likeCount: 1000,
          repostCount: 500,
          replyCount: 250,
          quoteCount: 100,
        },
      };

      const result = extractEmbeddedPost(embed, fallbackCreatedAt);

      expect(result?.likeCount).toBe(1000);
      expect(result?.repostCount).toBe(500);
      expect(result?.replyCount).toBe(250);
      expect(result?.quoteCount).toBe(100);
    });

    it("should extract facets from value", () => {
      const facets = [
        {
          index: { byteStart: 0, byteEnd: 12 },
          features: [
            {
              $type: "app.bsky.richtext.facet#mention",
              did: "did:plc:mentioned",
            },
          ],
        },
      ];

      const embed = {
        record: {
          uri: "at://did:plc:author123/app.bsky.feed.post/post123",
          author: { did: "did:plc:author123", handle: "author.bsky.social" },
          value: {
            text: "@mentioned hello",
            facets,
          },
        },
      };

      const result = extractEmbeddedPost(embed, fallbackCreatedAt);

      expect(result?.facets).toEqual(facets);
    });

    it("should extract images from embeds array", () => {
      const embed = {
        record: {
          uri: "at://did:plc:author123/app.bsky.feed.post/post123",
          author: { did: "did:plc:author123", handle: "author.bsky.social" },
          value: { text: "Post with images" },
          embeds: [
            {
              $type: "app.bsky.embed.images#view",
              images: [
                {
                  thumb: "https://cdn.bsky.app/thumb1.jpg",
                  fullsize: "https://cdn.bsky.app/full1.jpg",
                  alt: "First image",
                  aspectRatio: { width: 1920, height: 1080 },
                },
                {
                  thumb: "https://cdn.bsky.app/thumb2.jpg",
                  fullsize: "https://cdn.bsky.app/full2.jpg",
                  alt: "Second image",
                  aspectRatio: { width: 1080, height: 1080 },
                },
              ],
            },
          ],
        },
      };

      const result = extractEmbeddedPost(embed, fallbackCreatedAt);

      expect(result?.media).toHaveLength(2);
      expect(result?.media?.[0]).toMatchObject({
        type: "image",
        thumbUrl: "https://cdn.bsky.app/thumb1.jpg",
        fullsizeUrl: "https://cdn.bsky.app/full1.jpg",
        alt: "First image",
        width: 1920,
        height: 1080,
      });
    });

    it("should extract video from embeds array", () => {
      const embed = {
        record: {
          uri: "at://did:plc:author123/app.bsky.feed.post/post123",
          author: { did: "did:plc:author123", handle: "author.bsky.social" },
          value: { text: "Post with video" },
          embeds: [
            {
              $type: "app.bsky.embed.video#view",
              playlist: "https://video.bsky.app/playlist.m3u8",
              thumbnail: "https://cdn.bsky.app/video-thumb.jpg",
              alt: "Cool video",
            },
          ],
        },
      };

      const result = extractEmbeddedPost(embed, fallbackCreatedAt);

      expect(result?.media).toHaveLength(1);
      expect(result?.media?.[0]).toMatchObject({
        type: "video",
        playlistUrl: "https://video.bsky.app/playlist.m3u8",
        thumbUrl: "https://cdn.bsky.app/video-thumb.jpg",
        alt: "Cool video",
      });
    });

    it("should extract external embed (link preview)", () => {
      const embed = {
        record: {
          uri: "at://did:plc:author123/app.bsky.feed.post/post123",
          author: { did: "did:plc:author123", handle: "author.bsky.social" },
          value: { text: "Check out this article" },
          embeds: [
            {
              $type: "app.bsky.embed.external#view",
              external: {
                uri: "https://example.com/article",
                title: "Great Article",
                description: "This is a fascinating read",
                thumb: "https://example.com/thumb.jpg",
              },
            },
          ],
        },
      };

      const result = extractEmbeddedPost(embed, fallbackCreatedAt);

      expect(result?.externalEmbed).toEqual({
        uri: "https://example.com/article",
        title: "Great Article",
        description: "This is a fascinating read",
        thumbUrl: "https://example.com/thumb.jpg",
      });
    });

    it("should extract external embed from value.embed when not in embeds array", () => {
      const embed = {
        record: {
          uri: "at://did:plc:author123/app.bsky.feed.post/post123",
          author: { did: "did:plc:author123", handle: "author.bsky.social" },
          value: {
            text: "Check this out",
            embed: {
              $type: "app.bsky.embed.external",
              external: {
                uri: "https://example.com/link",
                title: "Link Title",
                description: "Link description",
                thumb: "https://example.com/thumb.jpg",
              },
            },
          },
        },
      };

      const result = extractEmbeddedPost(embed, fallbackCreatedAt);

      expect(result?.externalEmbed).toEqual({
        uri: "https://example.com/link",
        title: "Link Title",
        description: "Link description",
        thumbUrl: "https://example.com/thumb.jpg",
      });
    });

    it("should handle blob thumb (not string) by returning null thumbUrl", () => {
      const embed = {
        record: {
          uri: "at://did:plc:author123/app.bsky.feed.post/post123",
          author: { did: "did:plc:author123", handle: "author.bsky.social" },
          value: { text: "Post with blob thumb" },
          embeds: [
            {
              $type: "app.bsky.embed.external#view",
              external: {
                uri: "https://example.com/article",
                title: "Article",
                description: "Description",
                thumb: {
                  $type: "blob",
                  ref: { $link: "bafyreiblob123" },
                  mimeType: "image/jpeg",
                  size: 12345,
                },
              },
            },
          ],
        },
      };

      const result = extractEmbeddedPost(embed, fallbackCreatedAt);

      expect(result?.externalEmbed?.thumbUrl).toBeNull();
    });

    it("should extract nested quoted post", () => {
      const embed = {
        record: {
          uri: "at://did:plc:outer/app.bsky.feed.post/outer123",
          author: { did: "did:plc:outer", handle: "outer.bsky.social" },
          value: {
            text: "I'm quoting this",
            createdAt: "2024-01-15T10:00:00.000Z",
          },
          embeds: [
            {
              $type: "app.bsky.embed.record#view",
              record: {
                uri: "at://did:plc:inner/app.bsky.feed.post/inner456",
                cid: "bafyreinner456",
                author: { did: "did:plc:inner", handle: "inner.bsky.social" },
                value: {
                  text: "Original post",
                  createdAt: "2024-01-14T08:00:00.000Z",
                },
              },
            },
          ],
        },
      };

      const result = extractEmbeddedPost(embed, fallbackCreatedAt);

      expect(result?.quotedPostUri).toBe(
        "at://did:plc:inner/app.bsky.feed.post/inner456"
      );
      expect(result?.quotedPost).not.toBeNull();
      expect(result?.quotedPost?.text).toBe("Original post");
      expect(result?.quotedPost?.author.handle).toBe("inner.bsky.social");
    });

    it("should handle deeply nested quoted posts", () => {
      // Create a chain of nested quotes
      const innermost = {
        record: {
          uri: "at://did:plc:level3/app.bsky.feed.post/level3",
          author: { did: "did:plc:level3", handle: "level3.bsky.social" },
          value: { text: "Level 3 (innermost)" },
        },
      };

      const middle = {
        record: {
          uri: "at://did:plc:level2/app.bsky.feed.post/level2",
          author: { did: "did:plc:level2", handle: "level2.bsky.social" },
          value: { text: "Level 2 (middle)" },
          embeds: [innermost],
        },
      };

      const outer = {
        record: {
          uri: "at://did:plc:level1/app.bsky.feed.post/level1",
          author: { did: "did:plc:level1", handle: "level1.bsky.social" },
          value: { text: "Level 1 (outer)" },
          embeds: [middle],
        },
      };

      const result = extractEmbeddedPost(outer, fallbackCreatedAt);

      expect(result?.text).toBe("Level 1 (outer)");
      expect(result?.quotedPost?.text).toBe("Level 2 (middle)");
      expect(result?.quotedPost?.quotedPost?.text).toBe("Level 3 (innermost)");
    });

    it("should respect MAX_QUOTE_DEPTH limit", () => {
      // MAX_QUOTE_DEPTH is 20, so depth >= 20 should be blocked
      const embed = {
        record: {
          uri: "at://did:plc:author/app.bsky.feed.post/abc123",
          author: { did: "did:plc:author", handle: "author.bsky.social" },
          value: { text: "Near limit" },
        },
      };

      // At depth < 20, should work
      expect(extractEmbeddedPost(embed, fallbackCreatedAt, 19)).not.toBeNull();

      // At depth >= MAX_QUOTE_DEPTH (20), should be blocked
      expect(extractEmbeddedPost(embed, fallbackCreatedAt, 21)).toBeNull();
      expect(extractEmbeddedPost(embed, fallbackCreatedAt, 25)).toBeNull();
    });

    it("should handle missing author gracefully", () => {
      const embed = {
        record: {
          uri: "at://did:plc:author/app.bsky.feed.post/abc123",
          value: { text: "No author specified" },
        },
      };

      const result = extractEmbeddedPost(embed, fallbackCreatedAt);

      expect(result?.author.did).toBe("unknown");
      expect(result?.author.handle).toBe("unknown");
    });

    it("should extract media from value.embed when embeds array is empty", () => {
      const embed = {
        record: {
          uri: "at://did:plc:author/app.bsky.feed.post/abc123",
          author: { did: "did:plc:author", handle: "author.bsky.social" },
          value: {
            text: "Post with image in value.embed",
            embed: {
              $type: "app.bsky.embed.images",
              images: [
                {
                  thumb: "https://cdn.bsky.app/thumb.jpg",
                  fullsize: "https://cdn.bsky.app/full.jpg",
                  alt: "Test image",
                },
              ],
            },
          },
        },
      };

      const result = extractEmbeddedPost(embed, fallbackCreatedAt);

      expect(result?.media).toHaveLength(1);
      expect(result?.media?.[0].thumbUrl).toBe(
        "https://cdn.bsky.app/thumb.jpg"
      );
    });

    it("should handle hydrated external view format", () => {
      const embed = {
        record: {
          uri: "at://did:plc:author/app.bsky.feed.post/abc123",
          author: { did: "did:plc:author", handle: "author.bsky.social" },
          value: { text: "Link post" },
          embeds: [
            {
              $type: "app.bsky.embed.external#view",
              uri: "https://example.com/page",
              title: "Hydrated Title",
              description: "Hydrated description",
              thumb: "https://example.com/thumb.jpg",
            },
          ],
        },
      };

      const result = extractEmbeddedPost(embed, fallbackCreatedAt);

      expect(result?.externalEmbed?.uri).toBe("https://example.com/page");
      expect(result?.externalEmbed?.title).toBe("Hydrated Title");
    });
  });

  describe("extractEmbeddedPostFromJson", () => {
    const fallbackCreatedAt = "2024-01-15T10:00:00.000Z";

    it("should return null for null json", () => {
      expect(extractEmbeddedPostFromJson(null, fallbackCreatedAt)).toBeNull();
    });

    it("should return null for undefined json", () => {
      expect(
        extractEmbeddedPostFromJson(undefined, fallbackCreatedAt)
      ).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(extractEmbeddedPostFromJson("", fallbackCreatedAt)).toBeNull();
    });

    it("should return null for invalid JSON", () => {
      expect(
        extractEmbeddedPostFromJson("{invalid", fallbackCreatedAt)
      ).toBeNull();
    });

    it("should parse valid JSON and extract post", () => {
      const embed = {
        record: {
          uri: "at://did:plc:author/app.bsky.feed.post/abc123",
          author: { did: "did:plc:author", handle: "author.bsky.social" },
          value: { text: "Quoted post from JSON" },
        },
      };

      const result = extractEmbeddedPostFromJson(
        JSON.stringify(embed),
        fallbackCreatedAt
      );

      expect(result).not.toBeNull();
      expect(result?.text).toBe("Quoted post from JSON");
    });
  });

  describe("extractMediaFromEmbeddedRecord", () => {
    it("should return empty array for null", () => {
      expect(extractMediaFromEmbeddedRecord(null)).toEqual([]);
    });

    it("should return empty array for non-object", () => {
      expect(extractMediaFromEmbeddedRecord("string")).toEqual([]);
      expect(extractMediaFromEmbeddedRecord(123)).toEqual([]);
    });

    it("should return empty array for object without images or video", () => {
      expect(extractMediaFromEmbeddedRecord({})).toEqual([]);
      expect(extractMediaFromEmbeddedRecord({ other: "stuff" })).toEqual([]);
    });

    it("should extract images", () => {
      const embed = {
        images: [
          {
            thumb: "https://cdn.bsky.app/thumb1.jpg",
            fullsize: "https://cdn.bsky.app/full1.jpg",
            alt: "Image 1",
          },
          {
            thumb: "https://cdn.bsky.app/thumb2.jpg",
            fullsize: "https://cdn.bsky.app/full2.jpg",
            alt: "Image 2",
          },
        ],
      };

      const result = extractMediaFromEmbeddedRecord(embed);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        type: "image",
        thumbUrl: "https://cdn.bsky.app/thumb1.jpg",
      });
      expect(result[1]).toMatchObject({
        type: "image",
        thumbUrl: "https://cdn.bsky.app/thumb2.jpg",
      });
    });

    it("should extract video", () => {
      const embed = {
        playlist: "https://video.bsky.app/playlist.m3u8",
        thumbnail: "https://cdn.bsky.app/thumb.jpg",
        alt: "Video alt",
      };

      const result = extractMediaFromEmbeddedRecord(embed);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "video",
        playlistUrl: "https://video.bsky.app/playlist.m3u8",
        thumbUrl: "https://cdn.bsky.app/thumb.jpg",
        alt: "Video alt",
      });
    });

    it("should extract video from nested video object", () => {
      const embed = {
        video: {
          playlist: "https://video.bsky.app/nested.m3u8",
          thumbnail: "https://cdn.bsky.app/nested-thumb.jpg",
          alt: "Nested video",
        },
      };

      const result = extractMediaFromEmbeddedRecord(embed);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "video",
        playlistUrl: "https://video.bsky.app/nested.m3u8",
        thumbUrl: "https://cdn.bsky.app/nested-thumb.jpg",
      });
    });

    it("should handle images without optional fields", () => {
      const embed = {
        images: [{ thumb: "https://cdn.bsky.app/thumb.jpg" }],
      };

      const result = extractMediaFromEmbeddedRecord(embed);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "image",
        thumbUrl: "https://cdn.bsky.app/thumb.jpg",
        fullsizeUrl: undefined,
        alt: undefined,
      });
    });

    it("should skip invalid image entries", () => {
      const embed = {
        images: [
          "not an object",
          null,
          { thumb: "https://cdn.bsky.app/valid.jpg" },
        ],
      };

      const result = extractMediaFromEmbeddedRecord(embed);

      expect(result).toHaveLength(1);
      expect(result[0].thumbUrl).toBe("https://cdn.bsky.app/valid.jpg");
    });
  });
});

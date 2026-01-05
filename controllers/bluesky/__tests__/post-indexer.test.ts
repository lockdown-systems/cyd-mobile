/**
 * @fileoverview Tests for PostIndexer
 */

/* eslint-disable @typescript-eslint/unbound-method */

import type { Agent } from "@atproto/api";
import type { SQLiteDatabase } from "expo-sqlite";

import {
  createAuthorFeedResponse,
  createFeedViewPost,
  createNestedQuotedPost,
  createPostView,
  createPostWithEngagement,
  createPostWithExternalEmbed,
  createPostWithFacets,
  createPostWithImages,
  createPostWithQuote,
  createPostWithQuotedExternalEmbed,
  createPostWithVideo,
  createReplyPost,
} from "@/testUtils/blueskyFixtures";
import { createMockDatabase } from "@/testUtils/mockDatabase";
import { PostIndexer, type PostIndexerDeps } from "../post-indexer";

describe("PostIndexer", () => {
  let mockDb: SQLiteDatabase;
  let mockAgent: Partial<Agent>;
  let deps: PostIndexerDeps;
  let updateProgressCalls: unknown[];
  let downloadedUrls: string[];

  beforeEach(() => {
    mockDb = createMockDatabase();
    updateProgressCalls = [];
    downloadedUrls = [];

    // Create a mock agent with API methods
    mockAgent = {
      app: {
        bsky: {
          feed: {
            getAuthorFeed: jest.fn(),
            getActorLikes: jest.fn(),
            getPosts: jest.fn(),
          },
          bookmark: {
            getBookmarks: jest.fn(),
          },
        },
      },
    } as unknown as Partial<Agent>;

    deps = {
      getDb: () => mockDb,
      getAgent: () => mockAgent as Agent,
      getDid: () => "did:plc:testuser",
      updateProgress: jest.fn((update) => updateProgressCalls.push(update)),
      waitForPause: jest.fn().mockResolvedValue(undefined),
      makeApiRequest: jest.fn(<T>(fn: () => T) =>
        fn()
      ) as PostIndexerDeps["makeApiRequest"],
      downloadMediaFromUrl: jest.fn(async (url: string) => {
        downloadedUrls.push(url);
        return `/local/path/${encodeURIComponent(url)}`;
      }),
    };
  });

  describe("indexPosts", () => {
    it("should call API and update progress on success", async () => {
      const posts = [
        createFeedViewPost({ post: { record: { text: "Post 1" } } }),
        createFeedViewPost({ post: { record: { text: "Post 2" } } }),
      ];

      (mockAgent.app!.bsky.feed.getAuthorFeed as jest.Mock).mockResolvedValue(
        createAuthorFeedResponse(posts, undefined)
      );

      const indexer = new PostIndexer(deps);
      await indexer.indexPosts();

      // Should have called API
      expect(mockAgent.app!.bsky.feed.getAuthorFeed).toHaveBeenCalled();

      // Should update progress
      expect(updateProgressCalls.length).toBeGreaterThan(0);
      const lastProgress = updateProgressCalls[updateProgressCalls.length - 1];
      expect(lastProgress).toMatchObject({
        currentAction: "Finished saving posts",
        isRunning: false,
      });
    });

    it("should paginate through multiple pages of posts", async () => {
      const page1 = Array.from({ length: 100 }, (_, i) =>
        createFeedViewPost({ post: { record: { text: `Post ${i}` } } })
      );
      const page2 = Array.from({ length: 50 }, (_, i) =>
        createFeedViewPost({ post: { record: { text: `Post ${100 + i}` } } })
      );

      (mockAgent.app!.bsky.feed.getAuthorFeed as jest.Mock)
        .mockResolvedValueOnce(createAuthorFeedResponse(page1, "cursor1"))
        .mockResolvedValueOnce(createAuthorFeedResponse(page2, undefined));

      const indexer = new PostIndexer(deps);
      await indexer.indexPosts();

      // Should have called API twice
      expect(mockAgent.app!.bsky.feed.getAuthorFeed).toHaveBeenCalledTimes(2);
    });

    it("should handle posts with facets", async () => {
      const posts = [createPostWithFacets()];

      (mockAgent.app!.bsky.feed.getAuthorFeed as jest.Mock).mockResolvedValue(
        createAuthorFeedResponse(posts, undefined)
      );

      const indexer = new PostIndexer(deps);
      await indexer.indexPosts();

      // Should complete without errors
      expect(mockAgent.app!.bsky.feed.getAuthorFeed).toHaveBeenCalled();
    });

    it("should handle posts with external embeds", async () => {
      const posts = [createPostWithExternalEmbed()];

      (mockAgent.app!.bsky.feed.getAuthorFeed as jest.Mock).mockResolvedValue(
        createAuthorFeedResponse(posts, undefined)
      );

      const indexer = new PostIndexer(deps);
      await indexer.indexPosts();

      // Should complete without errors
      expect(mockAgent.app!.bsky.feed.getAuthorFeed).toHaveBeenCalled();
    });

    it("should handle posts with images", async () => {
      const posts = [createPostWithImages(3)];

      (mockAgent.app!.bsky.feed.getAuthorFeed as jest.Mock).mockResolvedValue(
        createAuthorFeedResponse(posts, undefined)
      );

      const indexer = new PostIndexer(deps);
      await indexer.indexPosts();

      // Should complete without errors
      expect(mockAgent.app!.bsky.feed.getAuthorFeed).toHaveBeenCalled();
    });

    it("should handle posts with videos", async () => {
      const posts = [createPostWithVideo()];

      (mockAgent.app!.bsky.feed.getAuthorFeed as jest.Mock).mockResolvedValue(
        createAuthorFeedResponse(posts, undefined)
      );

      const indexer = new PostIndexer(deps);
      await indexer.indexPosts();

      // Should complete without errors
      expect(mockAgent.app!.bsky.feed.getAuthorFeed).toHaveBeenCalled();
    });

    it("should handle posts with quoted posts", async () => {
      const posts = [createPostWithQuote()];

      (mockAgent.app!.bsky.feed.getAuthorFeed as jest.Mock).mockResolvedValue(
        createAuthorFeedResponse(posts, undefined)
      );

      const indexer = new PostIndexer(deps);
      await indexer.indexPosts();

      // Should complete without errors
      expect(mockAgent.app!.bsky.feed.getAuthorFeed).toHaveBeenCalled();
    });

    it("should handle posts with quoted posts that have external embeds", async () => {
      const posts = [createPostWithQuotedExternalEmbed()];

      (mockAgent.app!.bsky.feed.getAuthorFeed as jest.Mock).mockResolvedValue(
        createAuthorFeedResponse(posts, undefined)
      );

      const indexer = new PostIndexer(deps);
      await indexer.indexPosts();

      // Should complete without errors
      expect(mockAgent.app!.bsky.feed.getAuthorFeed).toHaveBeenCalled();
    });

    it("should handle nested quoted posts", async () => {
      const posts = [createNestedQuotedPost()];

      (mockAgent.app!.bsky.feed.getAuthorFeed as jest.Mock).mockResolvedValue(
        createAuthorFeedResponse(posts, undefined)
      );

      const indexer = new PostIndexer(deps);
      await indexer.indexPosts();

      // Should complete without errors
      expect(mockAgent.app!.bsky.feed.getAuthorFeed).toHaveBeenCalled();
    });

    it("should handle reply posts", async () => {
      const posts = [createReplyPost()];

      (mockAgent.app!.bsky.feed.getAuthorFeed as jest.Mock).mockResolvedValue(
        createAuthorFeedResponse(posts, undefined)
      );

      const indexer = new PostIndexer(deps);
      await indexer.indexPosts();

      // Should complete without errors
      expect(mockAgent.app!.bsky.feed.getAuthorFeed).toHaveBeenCalled();
    });

    it("should handle posts with varying engagement counts", async () => {
      const posts = [
        createPostWithEngagement({ likeCount: 1000, repostCount: 500 }),
        createPostWithEngagement({ likeCount: 0, replyCount: 1 }),
        createPostWithEngagement({
          likeCount: 999999,
          repostCount: 50000,
          replyCount: 10000,
          quoteCount: 5000,
        }),
      ];

      (mockAgent.app!.bsky.feed.getAuthorFeed as jest.Mock).mockResolvedValue(
        createAuthorFeedResponse(posts, undefined)
      );

      const indexer = new PostIndexer(deps);
      await indexer.indexPosts();

      // Should complete without errors
      expect(mockAgent.app!.bsky.feed.getAuthorFeed).toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      (mockAgent.app!.bsky.feed.getAuthorFeed as jest.Mock).mockRejectedValue(
        new Error("API Error")
      );

      const indexer = new PostIndexer(deps);
      await expect(indexer.indexPosts()).rejects.toThrow("API Error");

      // Should update progress with error
      const lastProgress = updateProgressCalls[updateProgressCalls.length - 1];
      expect(lastProgress).toMatchObject({
        isRunning: false,
        error: "API Error",
      });
    });

    it("should throw if database is not initialized", async () => {
      deps.getDb = () => null;
      const indexer = new PostIndexer(deps);

      await expect(indexer.indexPosts()).rejects.toThrow(
        "Database not initialized"
      );
    });

    it("should throw if agent is not initialized", async () => {
      deps.getAgent = () => null;
      const indexer = new PostIndexer(deps);

      await expect(indexer.indexPosts()).rejects.toThrow(
        "Agent not initialized"
      );
    });
  });

  describe("indexLikes", () => {
    it("should index liked posts", async () => {
      const likes = [
        createFeedViewPost({ post: { record: { text: "Liked post 1" } } }),
        createFeedViewPost({ post: { record: { text: "Liked post 2" } } }),
      ];

      (mockAgent.app!.bsky.feed.getActorLikes as jest.Mock).mockResolvedValue({
        feed: likes,
        cursor: undefined,
      });

      const indexer = new PostIndexer(deps);
      await indexer.indexLikes();

      expect(mockAgent.app!.bsky.feed.getActorLikes).toHaveBeenCalled();
      const lastProgress = updateProgressCalls[updateProgressCalls.length - 1];
      expect(lastProgress).toMatchObject({
        currentAction: "Finished saving likes",
        isRunning: false,
      });
    });

    it("should handle likes with various embed types", async () => {
      const likes = [
        createPostWithImages(2),
        createPostWithExternalEmbed(),
        createPostWithQuote(),
      ];

      (mockAgent.app!.bsky.feed.getActorLikes as jest.Mock).mockResolvedValue({
        feed: likes,
        cursor: undefined,
      });

      const indexer = new PostIndexer(deps);
      await indexer.indexLikes();

      expect(mockAgent.app!.bsky.feed.getActorLikes).toHaveBeenCalled();
    });
  });

  describe("indexBookmarks", () => {
    it("should index bookmarked posts", async () => {
      const bookmarks = [
        createPostView({ record: { text: "Bookmarked post 1" } }),
        createPostView({ record: { text: "Bookmarked post 2" } }),
      ];

      (
        mockAgent.app!.bsky.bookmark.getBookmarks as jest.Mock
      ).mockResolvedValue({
        bookmarks,
        cursor: undefined,
      });

      const indexer = new PostIndexer(deps);
      await indexer.indexBookmarks();

      expect(mockAgent.app!.bsky.bookmark.getBookmarks).toHaveBeenCalled();
      const lastProgress = updateProgressCalls[updateProgressCalls.length - 1];
      expect(lastProgress).toMatchObject({
        currentAction: "Finished saving bookmarks",
        isRunning: false,
      });
    });

    it("should handle bookmarks with external embeds", async () => {
      const bookmarks = [createPostWithExternalEmbed().post];

      (
        mockAgent.app!.bsky.bookmark.getBookmarks as jest.Mock
      ).mockResolvedValue({
        bookmarks,
        cursor: undefined,
      });

      const indexer = new PostIndexer(deps);
      await indexer.indexBookmarks();

      expect(mockAgent.app!.bsky.bookmark.getBookmarks).toHaveBeenCalled();
    });
  });
});

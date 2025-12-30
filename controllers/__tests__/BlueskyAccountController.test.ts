/**
 * @fileoverview Tests for BlueskyAccountController
 */

import type { Agent, AppBskyFeedGetAuthorFeed } from "@atproto/api";
import { downloadAsync, getInfoAsync } from "expo-file-system";

import {
  createMockDatabase,
  type MockDatabase,
} from "@/testUtils/mockDatabase";
import {
  BlueskyAccountController,
  type BlueskyProgress,
} from "../BlueskyAccountController";

describe("BlueskyAccountController", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor and initialization", () => {
    it("should create a controller with the given account ID", () => {
      const controller = new BlueskyAccountController(123);
      expect(controller.getAccountId()).toBe(123);
    });

    it("should have account type of bluesky", () => {
      const controller = new BlueskyAccountController(1);
      expect(controller.getAccountType()).toBe("bluesky");
    });

    it("should generate a unique UUID", () => {
      const controller1 = new BlueskyAccountController(1);
      const controller2 = new BlueskyAccountController(2);

      expect(controller1.getAccountUUID()).toBeDefined();
      expect(controller2.getAccountUUID()).toBeDefined();
      expect(controller1.getAccountUUID()).not.toBe(
        controller2.getAccountUUID()
      );
    });
  });

  describe("resetProgress", () => {
    it("should return initial progress state", () => {
      const controller = new BlueskyAccountController(1);
      const progress = controller.resetProgress();

      // Save progress fields
      expect(progress.postsSaved).toBe(0);
      expect(progress.postsTotal).toBeNull();
      expect(progress.likesSaved).toBe(0);
      expect(progress.likesTotal).toBeNull();
      expect(progress.bookmarksSaved).toBe(0);
      expect(progress.bookmarksTotal).toBeNull();
      expect(progress.followsSaved).toBe(0);
      expect(progress.followsTotal).toBeNull();
      expect(progress.conversationsSaved).toBe(0);
      expect(progress.conversationsTotal).toBeNull();
      expect(progress.messagesSaved).toBe(0);
      expect(progress.messagesTotal).toBeNull();

      // Delete progress fields
      expect(progress.postsDeleted).toBe(0);
      expect(progress.postsToDelete).toBeNull();
      expect(progress.repostsDeleted).toBe(0);
      expect(progress.repostsToDelete).toBeNull();
      expect(progress.likesDeleted).toBe(0);
      expect(progress.likesToDelete).toBeNull();
      expect(progress.bookmarksDeleted).toBe(0);
      expect(progress.bookmarksToDelete).toBeNull();
      expect(progress.messagesDeleted).toBe(0);
      expect(progress.messagesToDelete).toBeNull();
      expect(progress.unfollowed).toBe(0);
      expect(progress.toUnfollow).toBeNull();

      // Status fields
      expect(progress.currentAction).toBe("");
      expect(progress.isRunning).toBe(false);
      expect(progress.error).toBeNull();
    });
  });

  describe("agent state", () => {
    it("should report agent not ready initially", () => {
      const controller = new BlueskyAccountController(1);
      expect(controller.isAgentReady()).toBe(false);
    });

    it("should return null DID initially", () => {
      const controller = new BlueskyAccountController(1);
      expect(controller.getDid()).toBeNull();
    });

    it("should return null handle initially", () => {
      const controller = new BlueskyAccountController(1);
      expect(controller.getHandle()).toBeNull();
    });
  });

  describe("callbacks", () => {
    it("should accept session expired callback", () => {
      const controller = new BlueskyAccountController(1);
      const callback = jest.fn();

      // Should not throw
      expect(() => {
        controller.setSessionExpiredCallback(callback);
      }).not.toThrow();
    });

    it("should accept rate limit callback", () => {
      const controller = new BlueskyAccountController(1);
      const callback = jest.fn();

      // Should not throw
      expect(() => {
        controller.setRateLimitCallback(callback);
      }).not.toThrow();
    });

    it("should accept progress callback", () => {
      const controller = new BlueskyAccountController(1);
      const callback = jest.fn<void, [BlueskyProgress]>();

      // Should not throw
      expect(() => {
        controller.setProgressCallback(callback);
      }).not.toThrow();
    });
  });

  describe("indexPosts", () => {
    type FeedViewPost = AppBskyFeedGetAuthorFeed.OutputSchema["feed"][number];

    const createFeedPost = (suffix: number): FeedViewPost => {
      const createdAt = new Date(1700000000000 + suffix).toISOString();
      return {
        post: {
          uri: `at://did:plc:test/app.bsky.feed.post/${suffix}`,
          cid: `cid-${suffix}`,
          author: {
            did: "did:plc:test",
            handle: "user.test",
            displayName: "Test User",
          },
          likeCount: 10 + suffix,
          repostCount: 20 + suffix,
          replyCount: 30 + suffix,
          quoteCount: 40 + suffix,
          record: {
            $type: "app.bsky.feed.post",
            text: `Post ${suffix}`,
            createdAt,
          },
          indexedAt: createdAt,
        },
      };
    };

    it("should fetch pages and store posts", async () => {
      const controller = new BlueskyAccountController(1);
      const mockDb = createMockDatabase();
      const getAuthorFeed = jest.fn();
      const controllerState = controller as unknown as {
        db: ReturnType<typeof createMockDatabase>;
        agent: Agent | null;
        did: string | null;
        handle: string | null;
      };
      controllerState.db = mockDb;
      controllerState.did = "did:plc:test";
      controllerState.handle = "user.test";
      const mockAgent = {
        app: {
          bsky: {
            feed: {
              getAuthorFeed,
            },
          },
        },
      } as unknown as Agent;
      controllerState.agent = mockAgent;

      const page1 = [createFeedPost(1)];
      const page2 = [createFeedPost(2)];

      getAuthorFeed
        .mockResolvedValueOnce({ data: { feed: page1, cursor: "cursor-2" } })
        .mockResolvedValueOnce({ data: { feed: page2 } });

      await controller.indexPosts();

      expect(getAuthorFeed).toHaveBeenCalledTimes(2);
      expect(getAuthorFeed).toHaveBeenNthCalledWith(1, {
        actor: "did:plc:test",
        cursor: undefined,
        limit: 100,
      });
      expect(getAuthorFeed).toHaveBeenNthCalledWith(2, {
        actor: "did:plc:test",
        cursor: "cursor-2",
        limit: 100,
      });

      const dbMocks = mockDb as unknown as MockDatabase;
      const insertCalls = dbMocks.runAsync.mock.calls.filter(
        ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO post")
      );
      expect(insertCalls).toHaveLength(2);
      const firstArgs = insertCalls[0]?.[1] as unknown[];
      const secondArgs = insertCalls[1]?.[1] as unknown[];
      expect(firstArgs?.slice(17, 21)).toEqual([11, 21, 31, 41]);
      expect(secondArgs?.slice(17, 21)).toEqual([12, 22, 32, 42]);
      expect(controller.progress.postsSaved).toBe(2);
      expect(controller.progress.isRunning).toBe(false);
    });

    it("should upsert posts by uri to avoid duplicates", async () => {
      const controller = new BlueskyAccountController(1);
      const mockDb = createMockDatabase();
      const getAuthorFeed = jest.fn();
      const controllerState = controller as unknown as {
        db: ReturnType<typeof createMockDatabase>;
        agent: Agent | null;
        did: string | null;
        handle: string | null;
      };
      controllerState.db = mockDb;
      controllerState.did = "did:plc:test";
      controllerState.handle = "user.test";
      controllerState.agent = {
        app: {
          bsky: {
            feed: {
              getAuthorFeed,
            },
          },
        },
      } as unknown as Agent;

      const original = createFeedPost(1);
      const updated: FeedViewPost = {
        ...original,
        post: {
          ...original.post,
          cid: "cid-updated",
          likeCount: 999,
          repostCount: 888,
          replyCount: 777,
          quoteCount: 666,
          record: {
            ...(original.post.record as {
              $type: string;
              text: string;
              createdAt: string;
            }),
            text: "Updated text",
          },
        },
      };

      getAuthorFeed.mockResolvedValueOnce({
        data: { feed: [original, updated] },
      });

      await controller.indexPosts();

      const dbMocks = mockDb as unknown as MockDatabase;
      const insertCalls = dbMocks.runAsync.mock.calls.filter(
        ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO post")
      );
      expect(insertCalls).toHaveLength(2);
      const sqlText = insertCalls[0]?.[0] as string;
      expect(sqlText).toContain("ON CONFLICT(uri) DO UPDATE");
      const secondArgs = insertCalls[1]?.[1] as unknown[];
      expect(secondArgs?.[1]).toBe("cid-updated");
      expect(secondArgs?.slice(17, 21)).toEqual([999, 888, 777, 666]);
    });

    it("should fail when database is not ready", async () => {
      const controller = new BlueskyAccountController(1);
      const getAuthorFeed = jest.fn();
      const controllerState = controller as unknown as {
        agent: Agent | null;
        did: string | null;
      };
      controllerState.agent = {
        app: { bsky: { feed: { getAuthorFeed } } },
      } as unknown as Agent;
      controllerState.did = "did:plc:test";

      await expect(controller.indexPosts()).rejects.toThrow(
        "Database not initialized"
      );
    });

    it("should fail when agent is not ready", async () => {
      const controller = new BlueskyAccountController(1);
      const controllerState = controller as unknown as {
        db: ReturnType<typeof createMockDatabase>;
      };
      controllerState.db = createMockDatabase();

      await expect(controller.indexPosts()).rejects.toThrow(
        "Agent not initialized"
      );
    });
  });

  describe("unimplemented save operations", () => {
    it("indexLikes should throw not implemented", async () => {
      const controller = new BlueskyAccountController(1);
      await expect(controller.indexLikes()).rejects.toThrow(
        "Not implemented yet"
      );
    });

    it("indexBookmarks should throw not implemented", async () => {
      const controller = new BlueskyAccountController(1);
      await expect(controller.indexBookmarks()).rejects.toThrow(
        "Not implemented yet"
      );
    });

    it("indexFollowing should throw not implemented", async () => {
      const controller = new BlueskyAccountController(1);
      await expect(controller.indexFollowing()).rejects.toThrow(
        "Not implemented yet"
      );
    });

    it("indexConversations should throw not implemented", async () => {
      const controller = new BlueskyAccountController(1);
      await expect(controller.indexConversations()).rejects.toThrow(
        "Not implemented yet"
      );
    });

    it("indexMessages should throw not implemented", async () => {
      const controller = new BlueskyAccountController(1);
      await expect(controller.indexMessages("convo-123")).rejects.toThrow(
        "Not implemented yet"
      );
    });
  });

  describe("unimplemented delete operations", () => {
    it("deletePosts should throw not implemented", async () => {
      const controller = new BlueskyAccountController(1);
      await expect(controller.deletePosts({})).rejects.toThrow(
        "Not implemented yet"
      );
    });

    it("deleteReposts should throw not implemented", async () => {
      const controller = new BlueskyAccountController(1);
      await expect(controller.deleteReposts({})).rejects.toThrow(
        "Not implemented yet"
      );
    });

    it("deleteLikes should throw not implemented", async () => {
      const controller = new BlueskyAccountController(1);
      await expect(controller.deleteLikes({})).rejects.toThrow(
        "Not implemented yet"
      );
    });

    it("deleteBookmarks should throw not implemented", async () => {
      const controller = new BlueskyAccountController(1);
      await expect(controller.deleteBookmarks()).rejects.toThrow(
        "Not implemented yet"
      );
    });

    it("deleteMessages should throw not implemented", async () => {
      const controller = new BlueskyAccountController(1);
      await expect(controller.deleteMessages({})).rejects.toThrow(
        "Not implemented yet"
      );
    });

    it("unfollowAll should throw not implemented", async () => {
      const controller = new BlueskyAccountController(1);
      await expect(controller.unfollowAll()).rejects.toThrow(
        "Not implemented yet"
      );
    });
  });

  describe("media operations", () => {
    it("should skip download when file already exists", async () => {
      const controller = new BlueskyAccountController(1);
      (controller as unknown as { agent: Agent | null }).agent = {} as Agent;
      (getInfoAsync as jest.Mock).mockResolvedValueOnce({
        exists: true,
        uri: "file:///existing",
      });

      const path = await controller.downloadMedia("blob-cid", "did:plc:123");

      expect(getInfoAsync).toHaveBeenCalledTimes(1);
      expect(downloadAsync).not.toHaveBeenCalled();
      expect(path).toContain("media/did%3Aplc%3A123/");
      expect(path.endsWith("blob-cid")).toBe(true);
    });

    it("should download media when missing", async () => {
      const controller = new BlueskyAccountController(1);
      (controller as unknown as { agent: Agent | null }).agent = {} as Agent;
      (getInfoAsync as jest.Mock).mockResolvedValueOnce({ exists: false });
      (downloadAsync as jest.Mock).mockResolvedValueOnce({
        uri: "file:///mock/downloaded",
      });

      const path = await controller.downloadMedia("bafy/test", "did:plc:123");

      expect(downloadAsync).toHaveBeenCalledTimes(1);
      const [url, dest] = (downloadAsync as jest.Mock).mock.calls[0];
      expect(url).toBe("https://cdn.bsky.app/blob/did%3Aplc%3A123/bafy%2Ftest");
      expect(dest).toBe(path);
      expect(path).toContain("media/did%3Aplc%3A123/");
      expect(path.endsWith("bafy%2Ftest")).toBe(true);
    });
  });

  describe("cleanup", () => {
    it("should reset agent state on cleanup", async () => {
      const controller = new BlueskyAccountController(1);

      await controller.cleanup();

      expect(controller.getDid()).toBeNull();
      expect(controller.getHandle()).toBeNull();
      expect(controller.isAgentReady()).toBe(false);
    });
  });

  describe("rate limit info", () => {
    it("should return initial rate limit info", () => {
      const controller = new BlueskyAccountController(1);
      const info = controller.getRateLimitInfo();

      expect(info.limit).toBe(3000);
      expect(info.remaining).toBe(3000);
      expect(info.resetAt).toBe(0);
      expect(info.isLimited).toBe(false);
    });

    it("should return a copy of rate limit info", () => {
      const controller = new BlueskyAccountController(1);
      const info1 = controller.getRateLimitInfo();
      const info2 = controller.getRateLimitInfo();

      // Should be equal but not the same object
      expect(info1).toEqual(info2);
      expect(info1).not.toBe(info2);
    });
  });

  describe("rate limit callback", () => {
    it("should call rate limit callback when set", () => {
      const controller = new BlueskyAccountController(1);
      const callback = jest.fn();

      controller.setRateLimitCallback(callback);

      // The callback should be stored and callable
      expect(callback).not.toHaveBeenCalled();
    });

    it("should allow replacing rate limit callback", () => {
      const controller = new BlueskyAccountController(1);
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      controller.setRateLimitCallback(callback1);
      controller.setRateLimitCallback(callback2);

      // Should not throw
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });
  });

  describe("session expired callback", () => {
    it("should call session expired callback when set", () => {
      const controller = new BlueskyAccountController(1);
      const callback = jest.fn().mockResolvedValue(undefined);

      controller.setSessionExpiredCallback(callback);

      // The callback should be stored
      expect(callback).not.toHaveBeenCalled();
    });

    it("should allow replacing session expired callback", () => {
      const controller = new BlueskyAccountController(1);
      const callback1 = jest.fn().mockResolvedValue(undefined);
      const callback2 = jest.fn().mockResolvedValue(undefined);

      controller.setSessionExpiredCallback(callback1);
      controller.setSessionExpiredCallback(callback2);

      // Should not throw
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });
  });

  describe("progress callback", () => {
    it("should call progress callback when set", () => {
      const controller = new BlueskyAccountController(1);
      const callback = jest.fn<void, [BlueskyProgress]>();

      controller.setProgressCallback(callback);

      // The callback should be stored
      expect(callback).not.toHaveBeenCalled();
    });
  });
});

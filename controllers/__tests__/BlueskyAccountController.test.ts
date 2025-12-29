/**
 * @fileoverview Tests for BlueskyAccountController
 */

import {
  BlueskyAccountController,
  type BlueskyProgress,
} from "../BlueskyAccountController";

describe("BlueskyAccountController", () => {
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

  describe("unimplemented save operations", () => {
    it("indexPosts should throw not implemented", async () => {
      const controller = new BlueskyAccountController(1);
      await expect(controller.indexPosts()).rejects.toThrow(
        "Not implemented yet"
      );
    });

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

  describe("unimplemented media operations", () => {
    it("downloadMedia should throw not implemented", async () => {
      const controller = new BlueskyAccountController(1);
      await expect(
        controller.downloadMedia("blob-cid", "did:plc:123")
      ).rejects.toThrow("Not implemented yet");
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
});

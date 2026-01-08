/**
 * @fileoverview Tests for delete job runners
 */

import type { AccountDeleteSettings } from "@/database/delete-settings";
import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit } from "../job-types";

import { runDeleteBookmarksJob } from "../jobs/delete-bookmarks";
import { runDeleteLikesJob } from "../jobs/delete-likes";
import { runDeleteMessagesJob } from "../jobs/delete-messages";
import { runDeletePostsJob } from "../jobs/delete-posts";
import { runDeleteRepostsJob } from "../jobs/delete-reposts";
import { runUnfollowUsersJob } from "../jobs/unfollow-users";

// Mock delete settings
const mockDeleteSettings: AccountDeleteSettings = {
  deletePosts: true,
  deletePostsDaysOldEnabled: false,
  deletePostsDaysOld: 0,
  deletePostsLikesThresholdEnabled: false,
  deletePostsLikesThreshold: 0,
  deletePostsRepostsThresholdEnabled: false,
  deletePostsRepostsThreshold: 0,
  deletePostsPreserveThreads: false,
  deleteReposts: true,
  deleteRepostsDaysOldEnabled: false,
  deleteRepostsDaysOld: 0,
  deleteLikes: true,
  deleteLikesDaysOldEnabled: false,
  deleteLikesDaysOld: 0,
  deleteBookmarks: true,
  deleteChats: true,
  deleteChatsDaysOldEnabled: false,
  deleteChatsDaysOld: 0,
  deleteUnfollowEveryone: true,
};

// Mock job
const mockJob: BlueskyJobRecord = {
  id: 1,
  jobType: "deletePosts",
  status: "running",
  scheduledAt: Date.now(),
  startedAt: Date.now(),
  finishedAt: null,
};

// Helper to create a mock emit function
function createMockEmit(): { emit: JobEmit; calls: Parameters<JobEmit>[0][] } {
  const calls: Parameters<JobEmit>[0][] = [];
  const emit: JobEmit = (update) => {
    calls.push(update);
  };
  return { emit, calls };
}

// Helper to create a mock controller
function createMockController(overrides?: Partial<BlueskyAccountController>) {
  return {
    isAgentReady: jest.fn().mockReturnValue(true),
    initAgent: jest.fn().mockResolvedValue(undefined),
    getDeleteSettings: jest.fn().mockReturnValue(mockDeleteSettings),
    waitForPause: jest.fn().mockResolvedValue(undefined),
    // Post-related
    getPostsToDeleteWithPreview: jest.fn().mockReturnValue([]),
    deletePost: jest.fn().mockResolvedValue(undefined),
    // Repost-related
    getRepostsToDelete: jest.fn().mockReturnValue([]),
    deleteRepost: jest.fn().mockResolvedValue(undefined),
    // Like-related
    getLikesToDelete: jest.fn().mockReturnValue([]),
    deleteLike: jest.fn().mockResolvedValue(undefined),
    // Bookmark-related
    getBookmarksToDelete: jest.fn().mockReturnValue([]),
    deleteBookmark: jest.fn().mockResolvedValue(undefined),
    // Message-related
    getMessagesToDelete: jest.fn().mockReturnValue([]),
    deleteMessage: jest.fn().mockResolvedValue(undefined),
    // Follow-related
    getFollowsToUnfollow: jest.fn().mockReturnValue([]),
    unfollowUser: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as BlueskyAccountController;
}

describe("Delete Job Runners", () => {
  describe("runDeletePostsJob", () => {
    it("should emit initial speech and progress", async () => {
      const controller = createMockController();
      const { emit, calls } = createMockEmit();

      await runDeletePostsJob(controller, mockJob, emit);

      expect(calls[0]).toMatchObject({
        speechText: "I'm deleting your posts",
        progressMessage: "Preparing to delete posts…",
        progressPercent: 0,
      });
    });

    it("should handle empty posts list", async () => {
      const controller = createMockController({
        getPostsToDeleteWithPreview: jest.fn().mockReturnValue([]),
      });
      const { emit, calls } = createMockEmit();

      await runDeletePostsJob(controller, mockJob, emit);

      const lastCall = calls[calls.length - 1];
      expect(lastCall.progressMessage).toBe("No posts to delete");
      expect(lastCall.progressPercent).toBe(1);
    });

    it("should delete posts and emit progress", async () => {
      const mockPosts = [
        {
          uri: "at://did:plc:test/app.bsky.feed.post/1",
          cid: "cid1",
          text: "Post 1",
          createdAt: "2024-01-01T00:00:00Z",
          savedAt: Date.now(),
          authorDid: "did:plc:test",
          authorHandle: "test.bsky.social",
          authorDisplayName: "Test",
          avatarUrl: null,
          avatarDataURI: null,
          likeCount: 0,
          repostCount: 0,
          replyCount: 0,
          quoteCount: 0,
          isReply: false,
        },
        {
          uri: "at://did:plc:test/app.bsky.feed.post/2",
          cid: "cid2",
          text: "Post 2",
          createdAt: "2024-01-02T00:00:00Z",
          savedAt: Date.now(),
          authorDid: "did:plc:test",
          authorHandle: "test.bsky.social",
          authorDisplayName: "Test",
          avatarUrl: null,
          avatarDataURI: null,
          likeCount: 0,
          repostCount: 0,
          replyCount: 0,
          quoteCount: 0,
          isReply: false,
        },
      ];

      const controller = createMockController({
        getPostsToDeleteWithPreview: jest.fn().mockReturnValue(mockPosts),
      });
      const { emit, calls } = createMockEmit();

      await runDeletePostsJob(controller, mockJob, emit);

      // Should have called deletePost for each post
      expect(controller.deletePost).toHaveBeenCalledTimes(2);
      expect(controller.deletePost).toHaveBeenCalledWith(mockPosts[0].uri);
      expect(controller.deletePost).toHaveBeenCalledWith(mockPosts[1].uri);

      // Should emit final progress
      const lastCall = calls[calls.length - 1];
      expect(lastCall.progressMessage).toBe("Deleted 2 posts");
      expect(lastCall.progressPercent).toBe(1);
    });

    it("should throw error if delete settings not found", async () => {
      const controller = createMockController({
        getDeleteSettings: jest.fn().mockReturnValue(null),
      });
      const { emit } = createMockEmit();

      await expect(
        runDeletePostsJob(controller, mockJob, emit)
      ).rejects.toThrow("Delete settings not found");
    });

    it("should continue on delete errors and report count", async () => {
      const mockPosts = [
        {
          uri: "at://did:plc:test/app.bsky.feed.post/1",
          cid: "cid1",
          text: "Post 1",
          createdAt: "2024-01-01T00:00:00Z",
          savedAt: Date.now(),
          authorDid: "did:plc:test",
          authorHandle: "test.bsky.social",
          authorDisplayName: "Test",
          avatarUrl: null,
          avatarDataURI: null,
          likeCount: 0,
          repostCount: 0,
          replyCount: 0,
          quoteCount: 0,
          isReply: false,
        },
        {
          uri: "at://did:plc:test/app.bsky.feed.post/2",
          cid: "cid2",
          text: "Post 2",
          createdAt: "2024-01-02T00:00:00Z",
          savedAt: Date.now(),
          authorDid: "did:plc:test",
          authorHandle: "test.bsky.social",
          authorDisplayName: "Test",
          avatarUrl: null,
          avatarDataURI: null,
          likeCount: 0,
          repostCount: 0,
          replyCount: 0,
          quoteCount: 0,
          isReply: false,
        },
      ];

      const deletePost = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Delete failed"));

      const controller = createMockController({
        getPostsToDeleteWithPreview: jest.fn().mockReturnValue(mockPosts),
        deletePost,
      });
      const { emit, calls } = createMockEmit();

      await runDeletePostsJob(controller, mockJob, emit);

      const lastCall = calls[calls.length - 1];
      expect(lastCall.progressMessage).toBe("Deleted 1 posts (1 failed)");
    });

    it("should init agent if not ready", async () => {
      const controller = createMockController({
        isAgentReady: jest.fn().mockReturnValue(false),
      });
      const { emit } = createMockEmit();

      await runDeletePostsJob(controller, mockJob, emit);

      expect(controller.initAgent).toHaveBeenCalled();
    });
  });

  describe("runDeleteRepostsJob", () => {
    it("should emit initial speech and progress", async () => {
      const controller = createMockController();
      const { emit, calls } = createMockEmit();

      await runDeleteRepostsJob(
        controller,
        { ...mockJob, jobType: "deleteReposts" },
        emit
      );

      expect(calls[0]).toMatchObject({
        speechText: "I'm deleting your reposts",
        progressMessage: "Preparing to delete reposts…",
        progressPercent: 0,
      });
    });

    it("should handle empty reposts list", async () => {
      const controller = createMockController({
        getRepostsToDelete: jest.fn().mockReturnValue([]),
      });
      const { emit, calls } = createMockEmit();

      await runDeleteRepostsJob(
        controller,
        { ...mockJob, jobType: "deleteReposts" },
        emit
      );

      const lastCall = calls[calls.length - 1];
      expect(lastCall.progressMessage).toBe("No reposts to delete");
      expect(lastCall.progressPercent).toBe(1);
    });

    it("should delete reposts and emit progress", async () => {
      // Uses RepostToDelete type from deletion-calculator
      const mockReposts = [
        {
          uri: "at://did:plc:author/app.bsky.feed.post/1",
          repostUri: "at://did:plc:test/app.bsky.feed.repost/1",
          repostCid: "cid1",
          createdAt: "2024-01-01T00:00:00Z",
          originalPostUri: "at://did:plc:author/app.bsky.feed.post/1",
        },
      ];

      const controller = createMockController({
        getRepostsToDelete: jest.fn().mockReturnValue(mockReposts),
      });
      const { emit, calls } = createMockEmit();

      await runDeleteRepostsJob(
        controller,
        { ...mockJob, jobType: "deleteReposts" },
        emit
      );

      expect(controller.deleteRepost).toHaveBeenCalledWith(
        mockReposts[0].repostUri
      );

      const lastCall = calls[calls.length - 1];
      expect(lastCall.progressMessage).toBe("Deleted 1 reposts");
    });
  });

  describe("runDeleteLikesJob", () => {
    it("should emit initial speech and progress", async () => {
      const controller = createMockController();
      const { emit, calls } = createMockEmit();

      await runDeleteLikesJob(
        controller,
        { ...mockJob, jobType: "deleteLikes" },
        emit
      );

      expect(calls[0]).toMatchObject({
        speechText: "I'm deleting your likes",
        progressMessage: "Preparing to delete likes…",
        progressPercent: 0,
      });
    });

    it("should handle empty likes list", async () => {
      const controller = createMockController({
        getLikesToDelete: jest.fn().mockReturnValue([]),
      });
      const { emit, calls } = createMockEmit();

      await runDeleteLikesJob(
        controller,
        { ...mockJob, jobType: "deleteLikes" },
        emit
      );

      const lastCall = calls[calls.length - 1];
      expect(lastCall.progressMessage).toBe("No likes to delete");
    });

    it("should delete likes and emit progress", async () => {
      // Uses LikeToDelete type from deletion-calculator
      const mockLikes = [
        {
          uri: "at://did:plc:author/app.bsky.feed.post/1",
          createdAt: "2024-01-01T00:00:00Z",
          text: "Liked post",
          authorHandle: "author.bsky.social",
        },
      ];

      const controller = createMockController({
        getLikesToDelete: jest.fn().mockReturnValue(mockLikes),
      });
      const { emit, calls } = createMockEmit();

      await runDeleteLikesJob(
        controller,
        { ...mockJob, jobType: "deleteLikes" },
        emit
      );

      expect(controller.deleteLike).toHaveBeenCalledWith(mockLikes[0].uri);

      const lastCall = calls[calls.length - 1];
      expect(lastCall.progressMessage).toBe("Deleted 1 likes");
    });
  });

  describe("runDeleteBookmarksJob", () => {
    it("should emit initial speech and progress", async () => {
      const controller = createMockController();
      const { emit, calls } = createMockEmit();

      await runDeleteBookmarksJob(
        controller,
        { ...mockJob, jobType: "deleteBookmarks" },
        emit
      );

      expect(calls[0]).toMatchObject({
        speechText: "I'm deleting your bookmarks",
        progressMessage: "Preparing to delete bookmarks…",
        progressPercent: 0,
      });
    });

    it("should handle empty bookmarks list", async () => {
      const controller = createMockController({
        getBookmarksToDelete: jest.fn().mockReturnValue([]),
      });
      const { emit, calls } = createMockEmit();

      await runDeleteBookmarksJob(
        controller,
        { ...mockJob, jobType: "deleteBookmarks" },
        emit
      );

      const lastCall = calls[calls.length - 1];
      expect(lastCall.progressMessage).toBe("No bookmarks to delete");
    });

    it("should delete bookmarks and emit progress", async () => {
      // Uses BookmarkToDelete type from deletion-calculator
      const mockBookmarks = [
        {
          id: 1,
          subjectUri: "at://did:plc:author/app.bsky.feed.post/1",
          postText: "Bookmarked post",
        },
      ];

      const controller = createMockController({
        getBookmarksToDelete: jest.fn().mockReturnValue(mockBookmarks),
      });
      const { emit, calls } = createMockEmit();

      await runDeleteBookmarksJob(
        controller,
        { ...mockJob, jobType: "deleteBookmarks" },
        emit
      );

      expect(controller.deleteBookmark).toHaveBeenCalledWith(
        mockBookmarks[0].id
      );

      const lastCall = calls[calls.length - 1];
      expect(lastCall.progressMessage).toBe("Deleted 1 bookmarks");
    });
  });

  describe("runDeleteMessagesJob", () => {
    it("should emit initial speech and progress", async () => {
      const controller = createMockController();
      const { emit, calls } = createMockEmit();

      await runDeleteMessagesJob(
        controller,
        { ...mockJob, jobType: "deleteMessages" },
        emit
      );

      expect(calls[0]).toMatchObject({
        speechText: "I'm deleting your chat messages",
        progressMessage: "Preparing to delete messages…",
        progressPercent: 0,
      });
    });

    it("should handle empty messages list", async () => {
      const controller = createMockController({
        getMessagesToDelete: jest.fn().mockReturnValue([]),
      });
      const { emit, calls } = createMockEmit();

      await runDeleteMessagesJob(
        controller,
        { ...mockJob, jobType: "deleteMessages" },
        emit
      );

      const lastCall = calls[calls.length - 1];
      expect(lastCall.progressMessage).toBe("No messages to delete");
    });

    it("should delete messages and emit progress", async () => {
      // Uses MessageToDelete type from deletion-calculator
      const mockMessages = [
        {
          messageId: "msg1",
          convoId: "convo1",
          text: "Hello",
          sentAt: "2024-01-01T00:00:00Z",
        },
      ];

      const controller = createMockController({
        getMessagesToDelete: jest.fn().mockReturnValue(mockMessages),
      });
      const { emit, calls } = createMockEmit();

      await runDeleteMessagesJob(
        controller,
        { ...mockJob, jobType: "deleteMessages" },
        emit
      );

      expect(controller.deleteMessage).toHaveBeenCalledWith(
        mockMessages[0].convoId,
        mockMessages[0].messageId
      );

      const lastCall = calls[calls.length - 1];
      expect(lastCall.progressMessage).toBe("Deleted 1 messages");
    });
  });

  describe("runUnfollowUsersJob", () => {
    it("should emit initial speech and progress", async () => {
      const controller = createMockController();
      const { emit, calls } = createMockEmit();

      await runUnfollowUsersJob(
        controller,
        { ...mockJob, jobType: "unfollowUsers" },
        emit
      );

      expect(calls[0]).toMatchObject({
        speechText: "I'm unfollowing users for you",
        progressMessage: "Preparing to unfollow users…",
        progressPercent: 0,
      });
    });

    it("should handle empty follows list", async () => {
      const controller = createMockController({
        getFollowsToUnfollow: jest.fn().mockReturnValue([]),
      });
      const { emit, calls } = createMockEmit();

      await runUnfollowUsersJob(
        controller,
        { ...mockJob, jobType: "unfollowUsers" },
        emit
      );

      const lastCall = calls[calls.length - 1];
      expect(lastCall.progressMessage).toBe("No users to unfollow");
    });

    it("should unfollow users and emit progress with profile preview", async () => {
      // Uses FollowToUnfollow type from deletion-calculator
      const mockFollows = [
        {
          uri: "at://did:plc:me/app.bsky.graph.follow/1",
          cid: "cid1",
          subjectDid: "did:plc:user1",
          handle: "user1.bsky.social",
          displayName: "User One",
        },
      ];

      const controller = createMockController({
        getFollowsToUnfollow: jest.fn().mockReturnValue(mockFollows),
      });
      const { emit, calls } = createMockEmit();

      await runUnfollowUsersJob(
        controller,
        { ...mockJob, jobType: "unfollowUsers" },
        emit
      );

      expect(controller.unfollowUser).toHaveBeenCalledWith(mockFollows[0].uri);

      // Check that profile preview was emitted
      const previewCall = calls.find(
        (call) => call.previewData?.type === "profile"
      );
      expect(previewCall).toBeDefined();
      expect(previewCall?.previewData?.data).toMatchObject({
        did: mockFollows[0].subjectDid,
        handle: mockFollows[0].handle,
        displayName: mockFollows[0].displayName,
      });

      const lastCall = calls[calls.length - 1];
      expect(lastCall.progressMessage).toBe("Unfollowed 1 users");
    });

    it("should continue on unfollow errors and report count", async () => {
      // Uses FollowToUnfollow type from deletion-calculator
      const mockFollows = [
        {
          uri: "at://did:plc:me/app.bsky.graph.follow/1",
          cid: "cid1",
          subjectDid: "did:plc:user1",
          handle: "user1.bsky.social",
          displayName: "User One",
        },
        {
          uri: "at://did:plc:me/app.bsky.graph.follow/2",
          cid: "cid2",
          subjectDid: "did:plc:user2",
          handle: "user2.bsky.social",
          displayName: "User Two",
        },
      ];

      const unfollowUser = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Unfollow failed"));

      const controller = createMockController({
        getFollowsToUnfollow: jest.fn().mockReturnValue(mockFollows),
        unfollowUser,
      });
      const { emit, calls } = createMockEmit();

      await runUnfollowUsersJob(
        controller,
        { ...mockJob, jobType: "unfollowUsers" },
        emit
      );

      const lastCall = calls[calls.length - 1];
      expect(lastCall.progressMessage).toBe("Unfollowed 1 users (1 failed)");
    });
  });
});

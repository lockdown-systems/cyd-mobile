/**
 * @fileoverview Tests for deletion calculator functions
 */

import type { SQLiteDatabase } from "expo-sqlite";

import type { AccountDeleteSettings } from "@/database/delete-settings";
import {
  calculateBookmarksToDelete,
  calculateDeletionPreview,
  calculateDeletionPreviewCounts,
  calculateFollowsToUnfollow,
  calculateLikesToDelete,
  calculateMessagesToDelete,
  calculatePostsToDelete,
  calculateRepostsToDelete,
  getTimestampDaysAgo,
} from "../bluesky/deletion-calculator";

// Mock database that tracks queries
interface MockDbCall {
  sql: string;
  params: (string | number)[];
}

type MockDb = SQLiteDatabase & { _calls: MockDbCall[] };

function createMockDb(data: Record<string, unknown[]> = {}): MockDb {
  const calls: MockDbCall[] = [];

  const getAllSync = (sql: string, params: (string | number)[] = []) => {
    calls.push({ sql, params });
    // Return data based on what table is being queried
    // Check for preserved threads FIRST (it also has FROM post)
    if (sql.includes("threadRoot")) {
      return data.preservedThreads ?? [];
    }
    if (sql.includes("FROM post") && sql.includes("isRepost = 0")) {
      return data.posts ?? [];
    }
    if (sql.includes("FROM post") && sql.includes("isRepost = 1")) {
      return data.reposts ?? [];
    }
    if (sql.includes("FROM post") && sql.includes("viewerLiked = 1")) {
      return data.likes ?? [];
    }
    if (sql.includes("FROM message")) {
      return data.messages ?? [];
    }
    if (sql.includes("FROM bookmark")) {
      return data.bookmarks ?? [];
    }
    if (sql.includes("FROM follow")) {
      return data.follows ?? [];
    }
    return [];
  };

  return {
    getAllSync,
    _calls: calls,
  } as unknown as MockDb;
}

function createDefaultSettings(): AccountDeleteSettings {
  return {
    deletePosts: false,
    deletePostsDaysOldEnabled: false,
    deletePostsDaysOld: 0,
    deletePostsLikesThresholdEnabled: false,
    deletePostsLikesThreshold: 0,
    deletePostsRepostsThresholdEnabled: false,
    deletePostsRepostsThreshold: 0,
    deletePostsPreserveThreads: false,
    deleteReposts: false,
    deleteRepostsDaysOldEnabled: false,
    deleteRepostsDaysOld: 0,
    deleteLikes: false,
    deleteLikesDaysOldEnabled: false,
    deleteLikesDaysOld: 0,
    deleteBookmarks: false,
    deleteChats: false,
    deleteChatsDaysOldEnabled: false,
    deleteChatsDaysOld: 0,
    deleteUnfollowEveryone: false,
  };
}

describe("getTimestampDaysAgo", () => {
  it("should return current time for 0 days ago", () => {
    const now = new Date();
    const result = getTimestampDaysAgo(0);
    const resultDate = new Date(result);

    // Should be within a second of now
    expect(Math.abs(resultDate.getTime() - now.getTime())).toBeLessThan(1000);
  });

  it("should return 7 days ago", () => {
    const now = new Date();
    const result = getTimestampDaysAgo(7);
    const resultDate = new Date(result);

    const expectedDate = new Date(now);
    expectedDate.setDate(expectedDate.getDate() - 7);

    // Should be within a second of expected
    expect(
      Math.abs(resultDate.getTime() - expectedDate.getTime())
    ).toBeLessThan(1000);
  });

  it("should return valid ISO string", () => {
    const result = getTimestampDaysAgo(30);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe("calculatePostsToDelete", () => {
  const userDid = "did:plc:testuser";

  it("should return empty array when deletePosts is false", () => {
    const db = createMockDb();
    const settings = createDefaultSettings();

    const result = calculatePostsToDelete(db, userDid, settings);

    expect(result).toEqual([]);
    expect(db._calls).toHaveLength(0);
  });

  it("should return all posts when deletePosts is true with no filters", () => {
    const mockPosts = [
      {
        uri: "at://did:plc:testuser/app.bsky.feed.post/1",
        cid: "cid1",
        text: "Post 1",
        createdAt: "2024-01-01T00:00:00Z",
        likeCount: 5,
        repostCount: 2,
        replyRootUri: null,
      },
      {
        uri: "at://did:plc:testuser/app.bsky.feed.post/2",
        cid: "cid2",
        text: "Post 2",
        createdAt: "2024-01-02T00:00:00Z",
        likeCount: 10,
        repostCount: 5,
        replyRootUri: null,
      },
    ];
    const db = createMockDb({ posts: mockPosts });
    const settings = { ...createDefaultSettings(), deletePosts: true };

    const result = calculatePostsToDelete(db, userDid, settings);

    expect(result).toEqual(mockPosts);
  });

  it("should apply days-old filter when enabled", () => {
    const mockPosts = [
      {
        uri: "at://did:plc:testuser/app.bsky.feed.post/1",
        cid: "cid1",
        text: "Old Post",
        createdAt: "2024-01-01T00:00:00Z",
        likeCount: 5,
        repostCount: 2,
        replyRootUri: null,
      },
    ];
    const db = createMockDb({ posts: mockPosts });
    const settings = {
      ...createDefaultSettings(),
      deletePosts: true,
      deletePostsDaysOldEnabled: true,
      deletePostsDaysOld: 30,
    };

    calculatePostsToDelete(db, userDid, settings);

    // Check that the SQL includes the days-old filter
    expect(db._calls.length).toBeGreaterThan(0);
    const call = db._calls[0];
    expect(call.sql).toContain("createdAt <= ?");
    expect(call.params).toHaveLength(2); // userDid + timestamp
  });

  it("should apply likes threshold filter when enabled", () => {
    const mockPosts = [
      {
        uri: "at://did:plc:testuser/app.bsky.feed.post/1",
        cid: "cid1",
        text: "Low engagement post",
        createdAt: "2024-01-01T00:00:00Z",
        likeCount: 3,
        repostCount: 0,
        replyRootUri: null,
      },
    ];
    const db = createMockDb({ posts: mockPosts });
    const settings = {
      ...createDefaultSettings(),
      deletePosts: true,
      deletePostsLikesThresholdEnabled: true,
      deletePostsLikesThreshold: 10,
    };

    calculatePostsToDelete(db, userDid, settings);

    const call = db._calls[0];
    expect(call.sql).toContain("likeCount < ?");
    expect(call.params).toContain(10);
  });

  it("should apply reposts threshold filter when enabled", () => {
    const db = createMockDb({ posts: [] });
    const settings = {
      ...createDefaultSettings(),
      deletePosts: true,
      deletePostsRepostsThresholdEnabled: true,
      deletePostsRepostsThreshold: 5,
    };

    calculatePostsToDelete(db, userDid, settings);

    const call = db._calls[0];
    expect(call.sql).toContain("repostCount < ?");
    expect(call.params).toContain(5);
  });

  it("should combine multiple filters", () => {
    const db = createMockDb({ posts: [] });
    const settings = {
      ...createDefaultSettings(),
      deletePosts: true,
      deletePostsDaysOldEnabled: true,
      deletePostsDaysOld: 30,
      deletePostsLikesThresholdEnabled: true,
      deletePostsLikesThreshold: 10,
      deletePostsRepostsThresholdEnabled: true,
      deletePostsRepostsThreshold: 5,
    };

    calculatePostsToDelete(db, userDid, settings);

    const call = db._calls[0];
    expect(call.sql).toContain("createdAt <= ?");
    expect(call.sql).toContain("likeCount < ?");
    expect(call.sql).toContain("repostCount < ?");
  });

  it("should exclude posts with preserve flag", () => {
    const db = createMockDb({ posts: [] });
    const settings = { ...createDefaultSettings(), deletePosts: true };

    calculatePostsToDelete(db, userDid, settings);

    // Check that the SQL includes the preserve = 0 condition
    const call = db._calls[0];
    expect(call.sql).toContain("preserve = 0");
  });

  describe("deletePostsPreserveThreads", () => {
    it("should preserve entire thread when one post meets threshold", () => {
      // Scenario: User has 3 posts in a thread
      // Post A (root) - 5 likes (below threshold)
      // Post B (reply to A) - 15 likes (above threshold of 10)
      // Post C (reply to A) - 3 likes (below threshold)
      // With preserveThreads, none should be deleted because B meets threshold

      const candidatePosts = [
        {
          uri: "at://did:plc:testuser/app.bsky.feed.post/A",
          cid: "cidA",
          text: "Root post",
          createdAt: "2024-01-01T00:00:00Z",
          likeCount: 5,
          repostCount: 0,
          replyRootUri: null, // This is the root
        },
        {
          uri: "at://did:plc:testuser/app.bsky.feed.post/C",
          cid: "cidC",
          text: "Reply to root",
          createdAt: "2024-01-01T02:00:00Z",
          likeCount: 3,
          repostCount: 0,
          replyRootUri: "at://did:plc:testuser/app.bsky.feed.post/A",
        },
      ];

      // Post B meets the threshold, so its thread root should be preserved
      const preservedThreads = [
        { threadRoot: "at://did:plc:testuser/app.bsky.feed.post/A" },
      ];

      const db = createMockDb({
        posts: candidatePosts,
        preservedThreads: preservedThreads,
      });

      const settings = {
        ...createDefaultSettings(),
        deletePosts: true,
        deletePostsLikesThresholdEnabled: true,
        deletePostsLikesThreshold: 10,
        deletePostsPreserveThreads: true,
      };

      const result = calculatePostsToDelete(db, userDid, settings);

      // Both posts A and C should be filtered out because their thread root
      // (A) is preserved due to post B meeting the threshold
      expect(result).toEqual([]);
    });

    it("should delete posts from threads with no high-engagement posts", () => {
      const candidatePosts = [
        {
          uri: "at://did:plc:testuser/app.bsky.feed.post/X",
          cid: "cidX",
          text: "Standalone post",
          createdAt: "2024-01-01T00:00:00Z",
          likeCount: 2,
          repostCount: 0,
          replyRootUri: null,
        },
      ];

      const db = createMockDb({
        posts: candidatePosts,
        preservedThreads: [], // No threads meet threshold
      });

      const settings = {
        ...createDefaultSettings(),
        deletePosts: true,
        deletePostsLikesThresholdEnabled: true,
        deletePostsLikesThreshold: 10,
        deletePostsPreserveThreads: true,
      };

      const result = calculatePostsToDelete(db, userDid, settings);

      // Post X should be deleted since no post in its thread meets threshold
      expect(result).toEqual(candidatePosts);
    });

    it("should not query for preserved threads when no thresholds are enabled", () => {
      const candidatePosts = [
        {
          uri: "at://did:plc:testuser/app.bsky.feed.post/1",
          cid: "cid1",
          text: "Post",
          createdAt: "2024-01-01T00:00:00Z",
          likeCount: 5,
          repostCount: 2,
          replyRootUri: null,
        },
      ];

      const db = createMockDb({ posts: candidatePosts });
      const settings = {
        ...createDefaultSettings(),
        deletePosts: true,
        deletePostsPreserveThreads: true, // Enabled but no thresholds
      };

      const result = calculatePostsToDelete(db, userDid, settings);

      // Should return the post since no thresholds mean no threads to preserve
      expect(result).toEqual(candidatePosts);

      // Should only have one getAllSync call (for posts, not for preserved threads)
      const calls = db._calls;
      expect(calls.length).toBe(1);
    });
  });
});

describe("calculateRepostsToDelete", () => {
  const userDid = "did:plc:testuser";

  it("should return empty array when deleteReposts is false", () => {
    const db = createMockDb();
    const settings = createDefaultSettings();

    const result = calculateRepostsToDelete(db, userDid, settings);

    expect(result).toEqual([]);
    expect(db._calls).toHaveLength(0);
  });

  it("should return all reposts when deleteReposts is true with no filters", () => {
    const mockReposts = [
      {
        uri: "at://did:plc:testuser/app.bsky.feed.post/1",
        repostUri: "at://did:plc:testuser/app.bsky.feed.repost/1",
        repostCid: "repost-cid-1",
        createdAt: "2024-01-01T00:00:00Z",
        originalPostUri: "at://did:plc:other/app.bsky.feed.post/1",
      },
    ];
    const db = createMockDb({ reposts: mockReposts });
    const settings = { ...createDefaultSettings(), deleteReposts: true };

    const result = calculateRepostsToDelete(db, userDid, settings);

    expect(result).toEqual(mockReposts);
  });

  it("should apply days-old filter when enabled", () => {
    const db = createMockDb({ reposts: [] });
    const settings = {
      ...createDefaultSettings(),
      deleteReposts: true,
      deleteRepostsDaysOldEnabled: true,
      deleteRepostsDaysOld: 14,
    };

    calculateRepostsToDelete(db, userDid, settings);

    const call = db._calls[0];
    expect(call.sql).toContain("createdAt <= ?");
  });
});

describe("calculateLikesToDelete", () => {
  const userDid = "did:plc:testuser";

  it("should return empty array when deleteLikes is false", () => {
    const db = createMockDb();
    const settings = createDefaultSettings();

    const result = calculateLikesToDelete(db, userDid, settings);

    expect(result).toEqual([]);
  });

  it("should return liked posts when deleteLikes is true", () => {
    const mockLikes = [
      {
        uri: "at://did:plc:other/app.bsky.feed.post/1",
        createdAt: "2024-01-01T00:00:00Z",
        text: "A post I liked",
        authorHandle: "other.user",
      },
    ];
    const db = createMockDb({ likes: mockLikes });
    const settings = { ...createDefaultSettings(), deleteLikes: true };

    const result = calculateLikesToDelete(db, userDid, settings);

    expect(result).toEqual(mockLikes);
  });

  it("should apply days-old filter when enabled", () => {
    const db = createMockDb({ likes: [] });
    const settings = {
      ...createDefaultSettings(),
      deleteLikes: true,
      deleteLikesDaysOldEnabled: true,
      deleteLikesDaysOld: 60,
    };

    calculateLikesToDelete(db, userDid, settings);

    const call = db._calls[0];
    expect(call.sql).toContain("createdAt <= ?");
  });
});

describe("calculateMessagesToDelete", () => {
  const userDid = "did:plc:testuser";

  it("should return empty array when deleteChats is false", () => {
    const db = createMockDb();
    const settings = createDefaultSettings();

    const result = calculateMessagesToDelete(db, userDid, settings);

    expect(result).toEqual([]);
  });

  it("should return messages when deleteChats is true", () => {
    const mockMessages = [
      {
        messageId: "msg-1",
        convoId: "convo-1",
        text: "Hello there",
        sentAt: "2024-01-01T00:00:00Z",
      },
    ];
    const db = createMockDb({ messages: mockMessages });
    const settings = { ...createDefaultSettings(), deleteChats: true };

    const result = calculateMessagesToDelete(db, userDid, settings);

    expect(result).toEqual(mockMessages);
  });

  it("should apply days-old filter when enabled", () => {
    const db = createMockDb({ messages: [] });
    const settings = {
      ...createDefaultSettings(),
      deleteChats: true,
      deleteChatsDaysOldEnabled: true,
      deleteChatsDaysOld: 90,
    };

    calculateMessagesToDelete(db, userDid, settings);

    const call = db._calls[0];
    expect(call.sql).toContain("sentAt <= ?");
  });
});

describe("calculateBookmarksToDelete", () => {
  it("should return empty array when deleteBookmarks is false", () => {
    const db = createMockDb();
    const settings = createDefaultSettings();

    const result = calculateBookmarksToDelete(db, settings);

    expect(result).toEqual([]);
  });

  it("should return all bookmarks when deleteBookmarks is true", () => {
    const mockBookmarks = [
      { id: 1, subjectUri: "at://did:plc:other/post/1", postText: "Saved" },
      {
        id: 2,
        subjectUri: "at://did:plc:other/post/2",
        postText: "Also saved",
      },
    ];
    const db = createMockDb({ bookmarks: mockBookmarks });
    const settings = { ...createDefaultSettings(), deleteBookmarks: true };

    const result = calculateBookmarksToDelete(db, settings);

    expect(result).toEqual(mockBookmarks);
  });
});

describe("calculateFollowsToUnfollow", () => {
  it("should return empty array when deleteUnfollowEveryone is false", () => {
    const db = createMockDb();
    const settings = createDefaultSettings();

    const result = calculateFollowsToUnfollow(db, settings);

    expect(result).toEqual([]);
  });

  it("should return all follows when deleteUnfollowEveryone is true", () => {
    const mockFollows = [
      {
        uri: "at://did:plc:testuser/app.bsky.graph.follow/1",
        cid: "cid1",
        subjectDid: "did:plc:other1",
        handle: "other1.bsky.social",
        displayName: "Other User 1",
      },
      {
        uri: "at://did:plc:testuser/app.bsky.graph.follow/2",
        cid: "cid2",
        subjectDid: "did:plc:other2",
        handle: "other2.bsky.social",
        displayName: null,
      },
    ];
    const db = createMockDb({ follows: mockFollows });
    const settings = {
      ...createDefaultSettings(),
      deleteUnfollowEveryone: true,
    };

    const result = calculateFollowsToUnfollow(db, settings);

    expect(result).toEqual(mockFollows);
  });
});

describe("calculateDeletionPreview", () => {
  const userDid = "did:plc:testuser";

  it("should return empty preview when nothing is selected", () => {
    const db = createMockDb();
    const settings = createDefaultSettings();

    const result = calculateDeletionPreview(db, userDid, settings);

    expect(result).toEqual({
      postsToDelete: [],
      repostsToDelete: [],
      likesToDelete: [],
      messagesToDelete: [],
      bookmarksToDelete: [],
      followsToUnfollow: [],
    });
  });

  it("should include all selected categories", () => {
    const mockPosts = [
      {
        uri: "post1",
        cid: "cid1",
        text: "Post",
        createdAt: "2024-01-01",
        likeCount: 0,
        repostCount: 0,
        replyRootUri: null,
      },
    ];
    const mockReposts = [
      {
        uri: "repost1",
        repostUri: "r1",
        repostCid: "rc1",
        createdAt: "2024-01-01",
        originalPostUri: "op1",
      },
    ];
    const mockLikes = [
      {
        uri: "like1",
        createdAt: "2024-01-01",
        text: "Liked",
        authorHandle: "other",
      },
    ];
    const mockMessages = [
      { messageId: "msg1", convoId: "conv1", text: "Hi", sentAt: "2024-01-01" },
    ];
    const mockBookmarks = [
      { id: 1, subjectUri: "bm1", postText: "Bookmarked" },
    ];
    const mockFollows = [
      {
        uri: "f1",
        cid: "fc1",
        subjectDid: "did:other",
        handle: "other",
        displayName: "Other",
      },
    ];

    const db = createMockDb({
      posts: mockPosts,
      reposts: mockReposts,
      likes: mockLikes,
      messages: mockMessages,
      bookmarks: mockBookmarks,
      follows: mockFollows,
    });

    const settings = {
      ...createDefaultSettings(),
      deletePosts: true,
      deleteReposts: true,
      deleteLikes: true,
      deleteChats: true,
      deleteBookmarks: true,
      deleteUnfollowEveryone: true,
    };

    const result = calculateDeletionPreview(db, userDid, settings);

    expect(result.postsToDelete).toEqual(mockPosts);
    expect(result.repostsToDelete).toEqual(mockReposts);
    expect(result.likesToDelete).toEqual(mockLikes);
    expect(result.messagesToDelete).toEqual(mockMessages);
    expect(result.bookmarksToDelete).toEqual(mockBookmarks);
    expect(result.followsToUnfollow).toEqual(mockFollows);
  });
});

describe("calculateDeletionPreviewCounts", () => {
  const userDid = "did:plc:testuser";

  it("should return zero counts when nothing is selected", () => {
    const db = createMockDb();
    const settings = createDefaultSettings();

    const result = calculateDeletionPreviewCounts(db, userDid, settings);

    expect(result).toEqual({
      posts: 0,
      reposts: 0,
      likes: 0,
      messages: 0,
      bookmarks: 0,
      follows: 0,
    });
  });

  it("should return correct counts", () => {
    const mockPosts = [{ uri: "p1" }, { uri: "p2" }, { uri: "p3" }];
    const mockReposts = [{ uri: "r1" }];
    const mockLikes = [{ uri: "l1" }, { uri: "l2" }];
    const mockMessages = [
      { messageId: "m1" },
      { messageId: "m2" },
      { messageId: "m3" },
      { messageId: "m4" },
    ];
    const mockBookmarks = [{ id: 1 }];
    const mockFollows = [{ uri: "f1" }, { uri: "f2" }];

    const db = createMockDb({
      posts: mockPosts,
      reposts: mockReposts,
      likes: mockLikes,
      messages: mockMessages,
      bookmarks: mockBookmarks,
      follows: mockFollows,
    });

    const settings = {
      ...createDefaultSettings(),
      deletePosts: true,
      deleteReposts: true,
      deleteLikes: true,
      deleteChats: true,
      deleteBookmarks: true,
      deleteUnfollowEveryone: true,
    };

    const result = calculateDeletionPreviewCounts(db, userDid, settings);

    expect(result).toEqual({
      posts: 3,
      reposts: 1,
      likes: 2,
      messages: 4,
      bookmarks: 1,
      follows: 2,
    });
  });
});

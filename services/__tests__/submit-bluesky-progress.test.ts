import type { BlueskyDatabaseStats } from "@/controllers/bluesky/types";

import { submitBlueskyProgress } from "../submit-bluesky-progress";

const mockWithBlueskyController = jest.fn();

jest.mock("@/controllers", () => ({
  withBlueskyController: (...args: unknown[]) =>
    mockWithBlueskyController(...args),
}));

describe("submit-bluesky-progress", () => {
  const baseStats: BlueskyDatabaseStats = {
    postsCount: 10,
    repostsCount: 3,
    likesCount: 5,
    bookmarksCount: 7,
    followsCount: 1,
    conversationsCount: 2,
    messagesCount: 4,
    mediaDownloadedCount: 0,
    deletedPostsCount: 6,
    deletedRepostsCount: 8,
    deletedLikesCount: 9,
    deletedBookmarksCount: 11,
    deletedMessagesCount: 12,
    unfollowedCount: 13,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockWithBlueskyController.mockReset();
  });

  it("submits mapped stats and returns true on API success", async () => {
    const postBlueskyProgress = jest.fn(async () => true);
    const apiClient = { postBlueskyProgress };

    mockWithBlueskyController.mockImplementation(
      async (_accountId: number, _accountUUID: string, fn: unknown) => {
        const callback = fn as (controller: {
          getDatabaseStats: () => Promise<BlueskyDatabaseStats>;
        }) => Promise<BlueskyDatabaseStats>;

        return callback({
          getDatabaseStats: async () => baseStats,
        });
      },
    );

    const result = await submitBlueskyProgress(
      apiClient as never,
      123,
      "uuid-123",
    );

    expect(result).toBe(true);
    expect(mockWithBlueskyController).toHaveBeenCalledWith(
      123,
      "uuid-123",
      expect.any(Function),
    );
    expect(postBlueskyProgress).toHaveBeenCalledWith({
      account_uuid: "uuid-123",
      total_posts_saved: 10,
      total_reposts_saved: 3,
      total_likes_saved: 5,
      total_bookmarks_saved: 7,
      total_follows_saved: 1,
      total_conversations_saved: 2,
      total_messages_saved: 4,
      total_posts_deleted: 6,
      total_reposts_deleted: 8,
      total_likes_deleted: 9,
      total_bookmarks_deleted: 11,
      total_messages_deleted: 12,
      total_accounts_unfollowed: 13,
    });
  });

  it("returns false when registry helper throws", async () => {
    const apiClient = {
      postBlueskyProgress: jest.fn(async () => true),
    };

    mockWithBlueskyController.mockRejectedValue(new Error("db failed"));

    const result = await submitBlueskyProgress(apiClient as never, 7, "uuid-7");

    expect(result).toBe(false);
    expect(apiClient.postBlueskyProgress).not.toHaveBeenCalled();
  });

  it("returns false when API returns non-true result", async () => {
    const apiClient = {
      postBlueskyProgress: jest.fn(async () => ({ ok: false })),
    };

    mockWithBlueskyController.mockImplementation(
      async (_accountId: number, _accountUUID: string, fn: unknown) => {
        const callback = fn as (controller: {
          getDatabaseStats: () => Promise<BlueskyDatabaseStats>;
        }) => Promise<BlueskyDatabaseStats>;
        return callback({
          getDatabaseStats: async () => baseStats,
        });
      },
    );

    const result = await submitBlueskyProgress(apiClient as never, 9, "uuid-9");

    expect(result).toBe(false);
    expect(apiClient.postBlueskyProgress).toHaveBeenCalledTimes(1);
  });
});

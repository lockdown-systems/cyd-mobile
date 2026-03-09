import { render, waitFor } from "@testing-library/react-native";
import React from "react";

import { PostsToDeleteReviewModal } from "../PostsToDeleteReviewModal";

const mockGetBlueskyController = jest.fn();
const mockControllerInitAgent = jest.fn();
const mockControllerGetPosts = jest.fn();
const mockControllerGetDb = jest.fn();

jest.mock("@/hooks/use-modal-bottom-padding", () => ({
  useModalBottomPadding: () => 12,
}));

jest.mock("@/components/account/browse-shared", () => ({
  fetchMediaForPosts: jest.fn().mockResolvedValue(new Map()),
  fetchExternalEmbedsForPosts: jest.fn().mockResolvedValue(new Map()),
}));

jest.mock("@/components/PostPreview", () => ({
  PostPreview: () => null,
}));

jest.mock("@/controllers", () => ({
  getBlueskyController: jest.fn().mockImplementation(async () => {
    mockGetBlueskyController();
    return {
      initAgent: mockControllerInitAgent.mockResolvedValue(undefined),
      getPostsForDeletionReview: mockControllerGetPosts.mockReturnValue([]),
      getDB: mockControllerGetDb.mockReturnValue({}),
      setPostPreserve: jest.fn(),
    };
  }),
}));

const palette = {
  background: "#fff",
  card: "#fff",
  text: "#111",
  tint: "#00f",
  icon: "#666",
} as const;

const selections = {
  deletePosts: true,
  deletePostsDaysOldEnabled: false,
  deletePostsDaysOld: 30,
  deletePostsLikesThresholdEnabled: false,
  deletePostsLikesThreshold: 100,
  deletePostsRepostsThresholdEnabled: false,
  deletePostsRepostsThreshold: 100,
  deletePostsPreserveThreads: true,
  deleteReposts: false,
  deleteRepostsDaysOldEnabled: false,
  deleteRepostsDaysOld: 30,
  deleteLikes: false,
  deleteLikesDaysOldEnabled: false,
  deleteLikesDaysOld: 30,
  deleteBookmarks: false,
  deleteChats: false,
  deleteChatsDaysOldEnabled: false,
  deleteChatsDaysOld: 14,
  deleteUnfollowEveryone: false,
};

describe("PostsToDeleteReviewModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps manager-owned controller when modal unmounts", async () => {
    const onClose = jest.fn();
    const { unmount } = render(
      <PostsToDeleteReviewModal
        visible={true}
        onClose={onClose}
        accountId={1}
        accountUUID="uuid-1"
        palette={palette}
        selections={selections}
      />,
    );

    await waitFor(() => {
      expect(mockControllerInitAgent).toHaveBeenCalled();
    });

    unmount();

    expect(mockGetBlueskyController).toHaveBeenCalled();
  });

  it("does not release manager-owned controller when visibility changes to false", async () => {
    const onClose = jest.fn();
    const { rerender } = render(
      <PostsToDeleteReviewModal
        visible={true}
        onClose={onClose}
        accountId={1}
        accountUUID="uuid-1"
        palette={palette}
        selections={selections}
      />,
    );

    await waitFor(() => {
      expect(mockControllerInitAgent).toHaveBeenCalled();
    });

    rerender(
      <PostsToDeleteReviewModal
        visible={false}
        onClose={onClose}
        accountId={1}
        accountUUID="uuid-1"
        palette={palette}
        selections={selections}
      />,
    );

    expect(mockGetBlueskyController).toHaveBeenCalled();

    expect(onClose).not.toHaveBeenCalled();
  });
});

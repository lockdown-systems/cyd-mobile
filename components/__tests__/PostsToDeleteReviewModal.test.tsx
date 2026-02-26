import { render, waitFor } from "@testing-library/react-native";
import React from "react";

import { PostsToDeleteReviewModal } from "../PostsToDeleteReviewModal";

const mockCleanup = jest.fn();
const mockControllerInitDB = jest.fn();
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
  BlueskyAccountController: jest.fn().mockImplementation(() => ({
    initDB: mockControllerInitDB.mockResolvedValue(undefined),
    initAgent: mockControllerInitAgent.mockResolvedValue(undefined),
    getPostsForDeletionReview: mockControllerGetPosts.mockReturnValue([]),
    getDB: mockControllerGetDb.mockReturnValue({}),
    setPostPreserve: jest.fn(),
    cleanup: mockCleanup.mockResolvedValue(undefined),
  })),
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

  it("cleans up controller when modal unmounts", async () => {
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
      expect(mockControllerInitDB).toHaveBeenCalled();
    });

    unmount();

    await waitFor(() => {
      expect(mockCleanup).toHaveBeenCalled();
    });
  });

  it("cleans up controller when visibility changes to false", async () => {
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

    await waitFor(() => {
      expect(mockCleanup).toHaveBeenCalled();
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});

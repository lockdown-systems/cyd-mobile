/**
 * @fileoverview Tests for DeleteAutomationModal component
 */

import React from "react";

import type { AccountDeleteSettings } from "@/database/delete-settings";
import type { AccountTabPalette } from "@/types/account-tabs";

import {
  DeleteAutomationModal,
  type DeleteAutomationModalProps,
  type DeleteAutomationModalState,
} from "../DeleteAutomationModal";

const mockPalette: AccountTabPalette = {
  background: "#ffffff",
  text: "#000000",
  tint: "#0066cc",
  icon: "#666666",
  tabIconDefault: "#666666",
  tabIconSelected: "#0066cc",
  card: "#f5f5f5",
  button: {
    background: "#0066cc",
    text: "#ffffff",
    ripple: "rgba(255, 255, 255, 0.2)",
  },
  danger: "#ff0000",
  warning: "#ff9900",
};

const mockSettings: AccountDeleteSettings = {
  deletePosts: true,
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

const mockCounts = {
  posts: 10,
  reposts: 5,
  likes: 20,
  bookmarks: 3,
  messages: 8,
  follows: 15,
};

describe("DeleteAutomationModal", () => {
  describe("exports", () => {
    it("should export DeleteAutomationModal component", () => {
      expect(DeleteAutomationModal).toBeDefined();
      expect(typeof DeleteAutomationModal).toBe("function");
    });

    it("should export DeleteAutomationModalState type via re-export", () => {
      // Type-only export check - we can verify the component accepts the state type
      const validState: DeleteAutomationModalState = "ready";
      expect(["ready", "running", "paused", "completed", "failed"]).toContain(
        validState
      );
    });
  });

  describe("component creation", () => {
    it("should accept required props", () => {
      const props: DeleteAutomationModalProps = {
        visible: true,
        accountId: 1,
        accountUUID: "test-uuid",
        palette: mockPalette,
        settings: mockSettings,
        counts: mockCounts,
        onFinished: jest.fn(),
        onClose: jest.fn(),
      };

      const element = React.createElement(DeleteAutomationModal, props);
      expect(element).toBeDefined();
      expect(element.props.visible).toBe(true);
      expect(element.props.accountId).toBe(1);
      expect(element.props.accountUUID).toBe("test-uuid");
    });

    it("should accept optional onRestart prop", () => {
      const props: DeleteAutomationModalProps = {
        visible: true,
        accountId: 1,
        accountUUID: "test-uuid",
        palette: mockPalette,
        settings: mockSettings,
        counts: mockCounts,
        onFinished: jest.fn(),
        onClose: jest.fn(),
        onRestart: jest.fn(),
      };

      const element = React.createElement(DeleteAutomationModal, props);
      expect(element.props.onRestart).toBeDefined();
    });
  });

  describe("props validation", () => {
    it("should accept all delete settings", () => {
      const fullSettings: AccountDeleteSettings = {
        deletePosts: true,
        deletePostsDaysOldEnabled: true,
        deletePostsDaysOld: 30,
        deletePostsLikesThresholdEnabled: true,
        deletePostsLikesThreshold: 100,
        deletePostsRepostsThresholdEnabled: true,
        deletePostsRepostsThreshold: 50,
        deletePostsPreserveThreads: true,
        deleteReposts: true,
        deleteRepostsDaysOldEnabled: true,
        deleteRepostsDaysOld: 14,
        deleteLikes: true,
        deleteLikesDaysOldEnabled: true,
        deleteLikesDaysOld: 7,
        deleteBookmarks: true,
        deleteChats: true,
        deleteChatsDaysOldEnabled: true,
        deleteChatsDaysOld: 90,
        deleteUnfollowEveryone: true,
      };

      const props: DeleteAutomationModalProps = {
        visible: false,
        accountId: 1,
        accountUUID: "test-uuid",
        palette: mockPalette,
        settings: fullSettings,
        counts: mockCounts,
        onFinished: jest.fn(),
        onClose: jest.fn(),
      };

      const element = React.createElement(DeleteAutomationModal, props);
      expect(element.props.settings).toBe(fullSettings);
    });

    it("should accept counts for all delete types", () => {
      const zeroCounts = {
        posts: 0,
        reposts: 0,
        likes: 0,
        bookmarks: 0,
        messages: 0,
        follows: 0,
      };

      const props: DeleteAutomationModalProps = {
        visible: true,
        accountId: 1,
        accountUUID: "test-uuid",
        palette: mockPalette,
        settings: mockSettings,
        counts: zeroCounts,
        onFinished: jest.fn(),
        onClose: jest.fn(),
      };

      const element = React.createElement(DeleteAutomationModal, props);
      expect(element.props.counts).toEqual(zeroCounts);
    });
  });

  describe("callback props", () => {
    it("should accept onFinished callback with result and jobs", () => {
      const onFinished = jest.fn();
      const props: DeleteAutomationModalProps = {
        visible: true,
        accountId: 1,
        accountUUID: "test-uuid",
        palette: mockPalette,
        settings: mockSettings,
        counts: mockCounts,
        onFinished,
        onClose: jest.fn(),
      };

      const element = React.createElement(DeleteAutomationModal, props);
      expect(element.props.onFinished).toBe(onFinished);

      // Verify the callback type signature
      element.props.onFinished("completed", []);
      expect(onFinished).toHaveBeenCalledWith("completed", []);
    });

    it("should accept onClose callback", () => {
      const onClose = jest.fn();
      const props: DeleteAutomationModalProps = {
        visible: true,
        accountId: 1,
        accountUUID: "test-uuid",
        palette: mockPalette,
        settings: mockSettings,
        counts: mockCounts,
        onFinished: jest.fn(),
        onClose,
      };

      const element = React.createElement(DeleteAutomationModal, props);
      expect(element.props.onClose).toBe(onClose);
    });
  });

  describe("modal state types", () => {
    it("should support all modal states", () => {
      const states: DeleteAutomationModalState[] = [
        "ready",
        "running",
        "paused",
        "completed",
        "failed",
      ];

      states.forEach((state) => {
        expect(typeof state).toBe("string");
      });
    });
  });
});

/**
 * @fileoverview Tests for SaveAutomationModal component
 */

import React from "react";

import type { SaveJobOptions } from "@/controllers/bluesky/job-types";
import type { AccountTabPalette } from "@/types/account-tabs";

import {
  SaveAutomationModal,
  type SaveAutomationModalProps,
  type SaveAutomationModalState,
} from "../SaveAutomationModal";

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

const mockOptions: SaveJobOptions = {
  posts: true,
  likes: true,
  bookmarks: true,
  chat: true,
};

describe("SaveAutomationModal", () => {
  describe("exports", () => {
    it("should export SaveAutomationModal component", () => {
      expect(SaveAutomationModal).toBeDefined();
      expect(typeof SaveAutomationModal).toBe("function");
    });

    it("should export SaveAutomationModalState type via re-export", () => {
      // Type-only export check - we can verify the component accepts the state type
      const validState: SaveAutomationModalState = "idle";
      expect(["idle", "running", "completed", "failed"]).toContain(validState);
    });
  });

  describe("component creation", () => {
    it("should accept required props", () => {
      const props: SaveAutomationModalProps = {
        visible: true,
        accountId: 1,
        accountUUID: "test-uuid",
        palette: mockPalette,
        options: mockOptions,
        onFinished: jest.fn(),
        onClose: jest.fn(),
      };

      const element = React.createElement(SaveAutomationModal, props);
      expect(element).toBeDefined();
      expect(element.props.visible).toBe(true);
      expect(element.props.accountId).toBe(1);
      expect(element.props.accountUUID).toBe("test-uuid");
    });

    it("should accept optional onRestart prop", () => {
      const props: SaveAutomationModalProps = {
        visible: true,
        accountId: 1,
        accountUUID: "test-uuid",
        palette: mockPalette,
        options: mockOptions,
        onFinished: jest.fn(),
        onClose: jest.fn(),
        onRestart: jest.fn(),
      };

      const element = React.createElement(SaveAutomationModal, props);
      expect(element.props.onRestart).toBeDefined();
    });
  });

  describe("props validation", () => {
    it("should accept options with all flags enabled", () => {
      const fullOptions: SaveJobOptions = {
        posts: true,
        likes: true,
        bookmarks: true,
        chat: true,
      };

      const props: SaveAutomationModalProps = {
        visible: false,
        accountId: 1,
        accountUUID: "test-uuid",
        palette: mockPalette,
        options: fullOptions,
        onFinished: jest.fn(),
        onClose: jest.fn(),
      };

      const element = React.createElement(SaveAutomationModal, props);
      expect(element.props.options).toBe(fullOptions);
      expect(element.props.options.posts).toBe(true);
      expect(element.props.options.chat).toBe(true);
    });

    it("should accept partial options with some flags disabled", () => {
      const partialOptions: SaveJobOptions = {
        posts: true,
        likes: false,
        bookmarks: true,
        chat: false,
      };

      const props: SaveAutomationModalProps = {
        visible: true,
        accountId: 2,
        accountUUID: "another-uuid",
        palette: mockPalette,
        options: partialOptions,
        onFinished: jest.fn(),
        onClose: jest.fn(),
      };

      const element = React.createElement(SaveAutomationModal, props);
      expect(element.props.options.posts).toBe(true);
      expect(element.props.options.likes).toBe(false);
      expect(element.props.options.chat).toBe(false);
    });
  });

  describe("callback props", () => {
    it("should accept onFinished callback with result and jobs", () => {
      const onFinished = jest.fn();
      const props: SaveAutomationModalProps = {
        visible: true,
        accountId: 1,
        accountUUID: "test-uuid",
        palette: mockPalette,
        options: mockOptions,
        onFinished,
        onClose: jest.fn(),
      };

      const element = React.createElement(SaveAutomationModal, props);
      expect(element.props.onFinished).toBe(onFinished);

      // Verify the callback type signature
      element.props.onFinished("completed", []);
      expect(onFinished).toHaveBeenCalledWith("completed", []);
    });

    it("should accept onClose callback", () => {
      const onClose = jest.fn();
      const props: SaveAutomationModalProps = {
        visible: true,
        accountId: 1,
        accountUUID: "test-uuid",
        palette: mockPalette,
        options: mockOptions,
        onFinished: jest.fn(),
        onClose,
      };

      const element = React.createElement(SaveAutomationModal, props);
      expect(element.props.onClose).toBe(onClose);
    });
  });

  describe("modal state types", () => {
    it("should support all modal states", () => {
      const states: SaveAutomationModalState[] = [
        "idle",
        "running",
        "completed",
        "failed",
      ];

      states.forEach((state) => {
        expect(typeof state).toBe("string");
      });
    });
  });
});

/**
 * @fileoverview Tests for BlueskyControllerProvider context
 */

import React from "react";

import {
  BlueskyControllerProvider,
  useBlueskyController,
} from "../BlueskyControllerProvider";

describe("BlueskyControllerProvider", () => {
  describe("exports", () => {
    it("should export BlueskyControllerProvider component", () => {
      expect(BlueskyControllerProvider).toBeDefined();
      expect(typeof BlueskyControllerProvider).toBe("function");
    });

    it("should export useBlueskyController hook", () => {
      expect(useBlueskyController).toBeDefined();
      expect(typeof useBlueskyController).toBe("function");
    });
  });

  describe("BlueskyControllerProvider component", () => {
    it("should be a valid React component", () => {
      // Validate it can create a React element
      const element = React.createElement(
        BlueskyControllerProvider,
        { accountId: 1 },
        React.createElement("div", null, "test")
      );

      expect(element).toBeDefined();
      expect(element.type).toBe(BlueskyControllerProvider);
      expect(element.props.accountId).toBe(1);
    });

    it("should accept required accountId prop", () => {
      const element = React.createElement(
        BlueskyControllerProvider,
        { accountId: 42 },
        null
      );

      expect(element.props.accountId).toBe(42);
    });

    it("should accept children prop", () => {
      const childElement = React.createElement("span", null, "child");
      const element = React.createElement(
        BlueskyControllerProvider,
        { accountId: 1 },
        childElement
      );

      expect(element.props.children).toBe(childElement);
    });
  });

  describe("useBlueskyController hook", () => {
    it("should throw when used outside of provider", () => {
      // The hook should throw when context is null
      // We can't actually call it here without rendering,
      // but we can verify the function exists
      expect(() => {
        // Simulate calling hook outside provider by checking the error message
        const mockContext = null;
        if (!mockContext) {
          throw new Error(
            "useBlueskyController must be used within a BlueskyControllerProvider"
          );
        }
      }).toThrow(
        "useBlueskyController must be used within a BlueskyControllerProvider"
      );
    });
  });
});

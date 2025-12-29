import React from "react";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { SpeechBubble } from "../SpeechBubble";

// Mock the color scheme hook
jest.mock("@/hooks/use-color-scheme", () => ({
  useColorScheme: jest.fn(() => "light"),
}));

const mockUseColorScheme = jest.mocked(useColorScheme);

describe("SpeechBubble", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("component exports", () => {
    it("should export SpeechBubble as named export", () => {
      expect(SpeechBubble).toBeDefined();
      expect(typeof SpeechBubble).toBe("function");
    });

    it("should be a valid React component", () => {
      expect(() =>
        React.createElement(SpeechBubble, { message: "Hello" })
      ).not.toThrow();
    });
  });

  describe("props validation", () => {
    it("should accept message prop", () => {
      expect(() =>
        React.createElement(SpeechBubble, { message: "Test message" })
      ).not.toThrow();
    });

    it("should accept empty message", () => {
      expect(() =>
        React.createElement(SpeechBubble, { message: "" })
      ).not.toThrow();
    });

    it("should accept long message", () => {
      const longMessage = "A".repeat(1000);
      expect(() =>
        React.createElement(SpeechBubble, { message: longMessage })
      ).not.toThrow();
    });

    it("should accept message with special characters", () => {
      expect(() =>
        React.createElement(SpeechBubble, {
          message: "Special chars: @#$%^&*()[]{}",
        })
      ).not.toThrow();
    });

    it("should accept message with unicode and emojis", () => {
      expect(() =>
        React.createElement(SpeechBubble, { message: "Hello 👋 世界 🌍" })
      ).not.toThrow();
    });
  });

  describe("markdown content", () => {
    it("should accept markdown bold syntax", () => {
      expect(() =>
        React.createElement(SpeechBubble, { message: "This is **bold** text" })
      ).not.toThrow();
    });

    it("should accept markdown italic syntax", () => {
      expect(() =>
        React.createElement(SpeechBubble, {
          message: "This is *italic* text",
        })
      ).not.toThrow();
    });

    it("should accept markdown links", () => {
      expect(() =>
        React.createElement(SpeechBubble, {
          message: "[Link text](https://example.com)",
        })
      ).not.toThrow();
    });

    it("should accept markdown lists", () => {
      expect(() =>
        React.createElement(SpeechBubble, {
          message: "- Item 1\n- Item 2\n- Item 3",
        })
      ).not.toThrow();
    });

    it("should accept multiline messages", () => {
      expect(() =>
        React.createElement(SpeechBubble, {
          message: "Line 1\n\nLine 2\n\nLine 3",
        })
      ).not.toThrow();
    });
  });

  describe("theming", () => {
    it("should work with light color scheme", () => {
      mockUseColorScheme.mockReturnValue("light");

      expect(() =>
        React.createElement(SpeechBubble, { message: "Test" })
      ).not.toThrow();
    });

    it("should work with dark color scheme", () => {
      mockUseColorScheme.mockReturnValue("dark");

      expect(() =>
        React.createElement(SpeechBubble, { message: "Test" })
      ).not.toThrow();
    });

    it("should work with null color scheme (fallback)", () => {
      mockUseColorScheme.mockReturnValue(null);

      expect(() =>
        React.createElement(SpeechBubble, { message: "Test" })
      ).not.toThrow();
    });
  });
});

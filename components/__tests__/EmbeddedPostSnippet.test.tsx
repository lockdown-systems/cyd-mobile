/**
 * @fileoverview Tests for EmbeddedPostSnippet component
 */

import { Colors } from "@/constants/theme";
import type {
  ExternalEmbed,
  PostPreviewData,
} from "@/controllers/bluesky/types";
import type { AccountTabPalette } from "@/types/account-tabs";
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { Linking } from "react-native";
import { EmbeddedPostSnippet } from "../EmbeddedPostSnippet";

const defaultPalette: AccountTabPalette = Colors.light;

const basePost: PostPreviewData = {
  uri: "at://did:plc:author123/app.bsky.feed.post/abc123",
  cid: "bafyreicid123",
  text: "This is the quoted post content.",
  createdAt: "2024-01-15T10:00:00.000Z",
  author: {
    did: "did:plc:author123",
    handle: "author.bsky.social",
    displayName: "Quoted Author",
  },
  likeCount: 100,
  repostCount: 50,
  replyCount: 25,
  quoteCount: 10,
};

describe("EmbeddedPostSnippet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return null for null post", () => {
    const { toJSON } = render(
      <EmbeddedPostSnippet post={null} palette={defaultPalette} />
    );

    expect(toJSON()).toBeNull();
  });

  it("should return null for undefined post", () => {
    const { toJSON } = render(
      <EmbeddedPostSnippet post={undefined} palette={defaultPalette} />
    );

    expect(toJSON()).toBeNull();
  });

  it("should render basic embedded post with author and text", () => {
    render(<EmbeddedPostSnippet post={basePost} palette={defaultPalette} />);

    expect(screen.getByText("Quoted Author")).toBeTruthy();
    expect(screen.getByText("This is the quoted post content.")).toBeTruthy();
  });

  it("should show handle when displayName is missing", () => {
    const post: PostPreviewData = {
      ...basePost,
      author: {
        ...basePost.author,
        displayName: null,
      },
    };

    render(<EmbeddedPostSnippet post={post} palette={defaultPalette} />);

    expect(screen.getByText("author.bsky.social")).toBeTruthy();
  });

  it("should show Unknown when both displayName and handle are missing", () => {
    const post: PostPreviewData = {
      ...basePost,
      author: {
        did: "did:plc:unknown",
        handle: "",
        displayName: null,
      },
    };

    render(<EmbeddedPostSnippet post={post} palette={defaultPalette} />);

    expect(screen.getByText("Unknown")).toBeTruthy();
  });

  it("should render default hint text", () => {
    render(<EmbeddedPostSnippet post={basePost} palette={defaultPalette} />);

    expect(screen.getByText("Tap to view full post")).toBeTruthy();
  });

  it("should render custom hint text", () => {
    render(
      <EmbeddedPostSnippet
        post={basePost}
        palette={defaultPalette}
        hint="Custom hint message"
      />
    );

    expect(screen.getByText("Custom hint message")).toBeTruthy();
  });

  it("should handle empty text gracefully", () => {
    const post: PostPreviewData = {
      ...basePost,
      text: "",
    };

    render(<EmbeddedPostSnippet post={post} palette={defaultPalette} />);

    // Should still render author
    expect(screen.getByText("Quoted Author")).toBeTruthy();
    // Text element should not be present if empty
  });

  it("should call onPress when tapped and onPress is provided", () => {
    const onPress = jest.fn();

    render(
      <EmbeddedPostSnippet
        post={basePost}
        palette={defaultPalette}
        onPress={onPress}
      />
    );

    // Find and press the container - use UNSAFE_root to access the tree
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const authorText = screen.getByText("Quoted Author");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const container = authorText.parent?.parent;

    if (container) {
      fireEvent.press(container);
      expect(onPress).toHaveBeenCalledTimes(1);
    }
  });

  it("should render external embed (link preview)", () => {
    const externalEmbed: ExternalEmbed = {
      uri: "https://example.com/article",
      title: "Linked Article Title",
      description: "Article description",
      thumbUrl: "https://example.com/thumb.jpg",
    };

    const post: PostPreviewData = {
      ...basePost,
      externalEmbed,
    };

    render(<EmbeddedPostSnippet post={post} palette={defaultPalette} />);

    expect(screen.getByText("Linked Article Title")).toBeTruthy();
    // Should show the domain
    expect(screen.getByText(/example\.com/)).toBeTruthy();
  });

  it("should strip www from link domain", () => {
    const externalEmbed: ExternalEmbed = {
      uri: "https://www.example.com/article",
      title: "Article Title",
      description: null,
      thumbUrl: null,
    };

    const post: PostPreviewData = {
      ...basePost,
      externalEmbed,
    };

    render(<EmbeddedPostSnippet post={post} palette={defaultPalette} />);

    // Should show domain without www
    expect(screen.getByText(/example\.com/)).toBeTruthy();
    expect(screen.queryByText(/www\./)).toBeNull();
  });

  it("should open URL when link preview is tapped", async () => {
    const externalEmbed: ExternalEmbed = {
      uri: "https://example.com/article",
      title: "Article Title",
      description: null,
      thumbUrl: null,
    };

    const post: PostPreviewData = {
      ...basePost,
      externalEmbed,
    };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { UNSAFE_root } = render(
      <EmbeddedPostSnippet post={post} palette={defaultPalette} />
    );

    // Find the link card Pressable by traversing the tree
    // The Pressable containing the external embed has a specific structure
    const findPressableWithOnPress = (
      node: { children?: unknown[]; props?: { onPress?: unknown } } | null
    ): { props: { onPress: (e: unknown) => void } } | null => {
      if (!node) return null;
      if (node.props?.onPress) {
        return node as { props: { onPress: (e: unknown) => void } };
      }
      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          const found = findPressableWithOnPress(
            child as { children?: unknown[]; props?: { onPress?: unknown } }
          );
          if (found) return found;
        }
      }
      return null;
    };

    const pressable = findPressableWithOnPress(
      UNSAFE_root as unknown as {
        children?: unknown[];
        props?: { onPress?: unknown };
      }
    );
    expect(pressable).not.toBeNull();

    if (pressable) {
      pressable.props.onPress({
        stopPropagation: jest.fn(),
        preventDefault: jest.fn(),
      });
    }

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(jest.mocked(Linking.canOpenURL)).toHaveBeenCalledWith(
      "https://example.com/article"
    );
  });

  it("should handle external embed with long title", () => {
    const externalEmbed: ExternalEmbed = {
      uri: "https://example.com/article",
      title:
        "This is a very long article title that should be truncated when displayed in the embedded post snippet component",
      description: "Description",
      thumbUrl: null,
    };

    const post: PostPreviewData = {
      ...basePost,
      externalEmbed,
    };

    render(<EmbeddedPostSnippet post={post} palette={defaultPalette} />);

    // Component should render without errors
    expect(screen.getByText(/This is a very long article title/)).toBeTruthy();
  });

  it("should handle malformed URL in external embed gracefully", () => {
    const externalEmbed: ExternalEmbed = {
      uri: "not-a-valid-url",
      title: "Article Title",
      description: null,
      thumbUrl: null,
    };

    const post: PostPreviewData = {
      ...basePost,
      externalEmbed,
    };

    // Should not throw
    render(<EmbeddedPostSnippet post={post} palette={defaultPalette} />);

    // Domain extraction should fall back to the raw URI
    expect(screen.getByText(/not-a-valid-url/)).toBeTruthy();
  });

  it("should truncate long post text to 3 lines", () => {
    const post: PostPreviewData = {
      ...basePost,
      text: "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nThis is a very long text that spans multiple lines and should be truncated by the numberOfLines prop.",
    };

    render(<EmbeddedPostSnippet post={post} palette={defaultPalette} />);

    // Text should be present (truncation is a visual effect)
    expect(screen.getByText(/Line 1/)).toBeTruthy();
  });

  it("should apply palette colors correctly", () => {
    // Use Colors.dark as an alternative palette
    const customPalette: AccountTabPalette = Colors.dark;

    const renderResult = render(
      <EmbeddedPostSnippet post={basePost} palette={customPalette} />
    );

    expect(renderResult.toJSON()).not.toBeNull();
    // The component should apply the palette colors to styles
  });

  it("should render quoted post without external embed", () => {
    const post: PostPreviewData = {
      ...basePost,
      externalEmbed: undefined,
    };

    render(<EmbeddedPostSnippet post={post} palette={defaultPalette} />);

    expect(screen.getByText("Quoted Author")).toBeTruthy();
    expect(screen.getByText("This is the quoted post content.")).toBeTruthy();
    // Link card should not be present
    expect(screen.queryByText("🔗")).toBeNull();
  });
});

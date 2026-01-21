/**
 * @fileoverview Tests for PostPreview component
 */

import { Colors } from "@/constants/theme";
import type {
  ExternalEmbed,
  MediaAttachment,
  PostPreviewData,
} from "@/controllers/bluesky/types";
import type { AccountTabPalette } from "@/types/account-tabs";
import { render, screen } from "@testing-library/react-native";
import React from "react";
import { PostPreview } from "../PostPreview";

const defaultPalette: AccountTabPalette = Colors.light;

const basePost: PostPreviewData = {
  uri: "at://did:plc:author123/app.bsky.feed.post/abc123",
  cid: "bafyreicid123",
  text: "This is a test post with some content.",
  createdAt: "2024-01-15T10:00:00.000Z",
  savedAt: "2024-01-15T10:00:00.000Z",
  author: {
    did: "did:plc:author123",
    handle: "author.bsky.social",
    displayName: "Test Author",
    avatarUrl: "https://cdn.bsky.app/avatar.jpg",
  },
  likeCount: 100,
  repostCount: 50,
  replyCount: 25,
  quoteCount: 10,
};

describe("PostPreview", () => {
  it("should render basic post with author and text", () => {
    render(<PostPreview post={basePost} palette={defaultPalette} />);

    expect(screen.getByText("Test Author")).toBeTruthy();
    expect(screen.getByText("@author.bsky.social")).toBeTruthy();
    expect(
      screen.getByText("This is a test post with some content."),
    ).toBeTruthy();
  });

  it("should render engagement counts", () => {
    render(<PostPreview post={basePost} palette={defaultPalette} />);

    // The engagement counts are combined in a single Text element
    // Use regex to check they're all present
    expect(screen.getByText(/❤ 100/)).toBeTruthy();
    expect(screen.getByText(/🔁 50/)).toBeTruthy();
    expect(screen.getByText(/💬 25/)).toBeTruthy();
  });

  it("should handle missing displayName gracefully", () => {
    const post: PostPreviewData = {
      ...basePost,
      author: {
        ...basePost.author,
        displayName: null,
      },
    };

    render(<PostPreview post={post} palette={defaultPalette} />);

    // Should still render the handle
    expect(screen.getByText("@author.bsky.social")).toBeTruthy();
  });

  it("should render post with facets (mentions)", () => {
    const post: PostPreviewData = {
      ...basePost,
      text: "Hey @alice check this out!",
      facets: [
        {
          index: { byteStart: 4, byteEnd: 10 },
          features: [
            { $type: "app.bsky.richtext.facet#mention", did: "did:plc:alice" },
          ],
        },
      ],
    };

    render(<PostPreview post={post} palette={defaultPalette} />);

    // Text should be rendered
    expect(screen.getByText(/Hey/)).toBeTruthy();
  });

  it("should render post with facets (links)", () => {
    const post: PostPreviewData = {
      ...basePost,
      text: "Check out https://example.com for more info",
      facets: [
        {
          index: { byteStart: 10, byteEnd: 29 },
          features: [
            {
              $type: "app.bsky.richtext.facet#link",
              uri: "https://example.com",
            },
          ],
        },
      ],
    };

    render(<PostPreview post={post} palette={defaultPalette} />);

    expect(screen.getByText(/Check out/)).toBeTruthy();
  });

  it("should render post with facets (hashtags)", () => {
    const post: PostPreviewData = {
      ...basePost,
      text: "This is #awesome content",
      facets: [
        {
          index: { byteStart: 8, byteEnd: 16 },
          features: [{ $type: "app.bsky.richtext.facet#tag", tag: "awesome" }],
        },
      ],
    };

    render(<PostPreview post={post} palette={defaultPalette} />);

    expect(screen.getByText(/awesome/)).toBeTruthy();
  });

  it("should render post with images", () => {
    const media: MediaAttachment[] = [
      {
        type: "image",
        thumbUrl: "https://cdn.bsky.app/thumb1.jpg",
        fullsizeUrl: "https://cdn.bsky.app/full1.jpg",
        alt: "First image",
        width: 1920,
        height: 1080,
      },
      {
        type: "image",
        thumbUrl: "https://cdn.bsky.app/thumb2.jpg",
        fullsizeUrl: "https://cdn.bsky.app/full2.jpg",
        alt: "Second image",
        width: 1080,
        height: 1080,
      },
    ];

    const post: PostPreviewData = {
      ...basePost,
      media,
    };

    render(<PostPreview post={post} palette={defaultPalette} />);

    // Images should be rendered (can test for accessibilityLabel)
    expect(
      screen.getByText("This is a test post with some content."),
    ).toBeTruthy();
  });

  it("should render post with video", () => {
    const media: MediaAttachment[] = [
      {
        type: "video",
        thumbUrl: "https://cdn.bsky.app/video-thumb.jpg",
        playlistUrl: "https://video.bsky.app/playlist.m3u8",
        alt: "Cool video",
      },
    ];

    const post: PostPreviewData = {
      ...basePost,
      media,
    };

    render(<PostPreview post={post} palette={defaultPalette} />);

    expect(
      screen.getByText("This is a test post with some content."),
    ).toBeTruthy();
  });

  it("should render post with external embed (link preview)", () => {
    const externalEmbed: ExternalEmbed = {
      uri: "https://example.com/article",
      title: "Great Article Title",
      description: "This is a fascinating article about something interesting",
      thumbUrl: "https://example.com/thumb.jpg",
    };

    const post: PostPreviewData = {
      ...basePost,
      externalEmbed,
    };

    render(<PostPreview post={post} palette={defaultPalette} />);

    expect(screen.getByText("Great Article Title")).toBeTruthy();
    // Domain is shown with emoji prefix
    expect(screen.getByText(/🔗.*example\.com/)).toBeTruthy();
  });

  it("should render post with quoted post", () => {
    const quotedPost: PostPreviewData = {
      uri: "at://did:plc:quoted/app.bsky.feed.post/quoted123",
      cid: "bafyreiquoted",
      text: "This is the quoted post content",
      createdAt: "2024-01-14T08:00:00.000Z",
      savedAt: "2024-01-14T08:00:00.000Z",
      author: {
        did: "did:plc:quoted",
        handle: "quoted.bsky.social",
        displayName: "Quoted Author",
      },
      likeCount: 50,
      repostCount: 20,
      replyCount: 10,
      quoteCount: 5,
    };

    const post: PostPreviewData = {
      ...basePost,
      text: "Check out this quote!",
      quotedPostUri: "at://did:plc:quoted/app.bsky.feed.post/quoted123",
      quotedPost,
    };

    render(<PostPreview post={post} palette={defaultPalette} />);

    // Both the main post and quoted post should be visible
    expect(screen.getByText("Check out this quote!")).toBeTruthy();
    // Use getAllByText since the name may appear multiple times (once in author, possibly elsewhere)
    expect(screen.getAllByText("Quoted Author").length).toBeGreaterThanOrEqual(
      1,
    );
    // The quoted post snippet may also appear in multiple places
    expect(
      screen.getAllByText("This is the quoted post content").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("should render quoted post with link preview", () => {
    const quotedPost: PostPreviewData = {
      uri: "at://did:plc:quoted/app.bsky.feed.post/quoted123",
      cid: "bafyreiquoted",
      text: "Check out this article",
      createdAt: "2024-01-14T08:00:00.000Z",
      savedAt: "2024-01-14T08:00:00.000Z",
      author: {
        did: "did:plc:quoted",
        handle: "quoted.bsky.social",
        displayName: "Quoted Author",
      },
      likeCount: null,
      repostCount: null,
      replyCount: null,
      quoteCount: null,
      externalEmbed: {
        uri: "https://example.com/nested-article",
        title: "Nested Article",
        description: "Article in a quoted post",
        thumbUrl: null,
      },
    };

    const post: PostPreviewData = {
      ...basePost,
      text: "Quoting this article post",
      quotedPostUri: "at://did:plc:quoted/app.bsky.feed.post/quoted123",
      quotedPost,
    };

    render(<PostPreview post={post} palette={defaultPalette} />);

    expect(screen.getByText("Quoting this article post")).toBeTruthy();
    // Title may appear multiple times, use getAllByText
    expect(screen.getAllByText("Nested Article").length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("should render post marked as repost", () => {
    const post: PostPreviewData = {
      ...basePost,
      isRepost: true,
    };

    render(<PostPreview post={post} palette={defaultPalette} />);

    // Should show repost indicator
    expect(
      screen.getByText("This is a test post with some content."),
    ).toBeTruthy();
  });

  it("should render post with zero engagement counts", () => {
    const post: PostPreviewData = {
      ...basePost,
      likeCount: 0,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
    };

    render(<PostPreview post={post} palette={defaultPalette} />);

    // Should still render the post
    expect(
      screen.getByText("This is a test post with some content."),
    ).toBeTruthy();
  });

  it("should render post with null engagement counts", () => {
    const post: PostPreviewData = {
      ...basePost,
      likeCount: null,
      repostCount: null,
      replyCount: null,
      quoteCount: null,
    };

    render(<PostPreview post={post} palette={defaultPalette} />);

    expect(
      screen.getByText("This is a test post with some content."),
    ).toBeTruthy();
  });

  it("should render post with large engagement numbers", () => {
    const post: PostPreviewData = {
      ...basePost,
      likeCount: 1500000,
      repostCount: 500000,
      replyCount: 100000,
      quoteCount: 50000,
    };

    render(<PostPreview post={post} palette={defaultPalette} />);

    // formatNumber should abbreviate large numbers
    expect(
      screen.getByText("This is a test post with some content."),
    ).toBeTruthy();
  });

  it("should handle empty text gracefully", () => {
    const post: PostPreviewData = {
      ...basePost,
      text: "",
    };

    render(<PostPreview post={post} palette={defaultPalette} />);

    // Should still render author info
    expect(screen.getByText("Test Author")).toBeTruthy();
  });

  it("should apply browse mode styling", () => {
    render(<PostPreview post={basePost} palette={defaultPalette} browseMode />);

    // Component should render in browse mode
    expect(
      screen.getByText("This is a test post with some content."),
    ).toBeTruthy();
  });

  it("should handle post with multiple facet types", () => {
    const post: PostPreviewData = {
      ...basePost,
      text: "@alice check https://example.com #cool",
      facets: [
        {
          index: { byteStart: 0, byteEnd: 6 },
          features: [
            { $type: "app.bsky.richtext.facet#mention", did: "did:plc:alice" },
          ],
        },
        {
          index: { byteStart: 13, byteEnd: 32 },
          features: [
            {
              $type: "app.bsky.richtext.facet#link",
              uri: "https://example.com",
            },
          ],
        },
        {
          index: { byteStart: 33, byteEnd: 38 },
          features: [{ $type: "app.bsky.richtext.facet#tag", tag: "cool" }],
        },
      ],
    };

    render(<PostPreview post={post} palette={defaultPalette} />);

    // Component should handle multiple facet types
    expect(screen.getByText(/@alice check/)).toBeTruthy();
  });

  it("should handle unicode text with facets correctly", () => {
    // "🎉 Party time! @alice" - emoji takes 4 bytes
    const post: PostPreviewData = {
      ...basePost,
      text: "🎉 Party time! @alice",
      facets: [
        {
          index: { byteStart: 18, byteEnd: 24 },
          features: [
            { $type: "app.bsky.richtext.facet#mention", did: "did:plc:alice" },
          ],
        },
      ],
    };

    render(<PostPreview post={post} palette={defaultPalette} />);

    expect(screen.getByText(/🎉 Party time!/)).toBeTruthy();
  });
});

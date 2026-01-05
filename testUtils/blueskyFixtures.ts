/**
 * Test fixtures for Bluesky API responses
 * These mimic the structure returned by the AT Protocol API
 */

import type {
  AppBskyActorDefs,
  AppBskyFeedDefs,
  AppBskyFeedPost,
} from "@atproto/api";

// Helper to create a DID
export function createDid(id: string): string {
  return `did:plc:${id}`;
}

// Helper to create a post URI
export function createPostUri(did: string, rkey: string): string {
  return `at://${did}/app.bsky.feed.post/${rkey}`;
}

// Helper to create a profile
export function createProfile(
  overrides?: Partial<AppBskyActorDefs.ProfileViewBasic>
): AppBskyActorDefs.ProfileViewBasic {
  const did = overrides?.did ?? createDid("test123");
  return {
    did,
    handle: overrides?.handle ?? "test.bsky.social",
    displayName: overrides?.displayName ?? "Test User",
    avatar: overrides?.avatar ?? "https://cdn.bsky.app/avatar/test.jpg",
    ...overrides,
  };
}

// Helper to create a basic post record
export function createPostRecord(
  overrides?: Partial<AppBskyFeedPost.Record>
): AppBskyFeedPost.Record {
  return {
    $type: "app.bsky.feed.post",
    text: overrides?.text ?? "This is a test post",
    createdAt: overrides?.createdAt ?? "2026-01-04T12:00:00.000Z",
    langs: overrides?.langs ?? ["en"],
    ...overrides,
  };
}

// Helper to create a post view
export function createPostView(
  overrides?: Partial<AppBskyFeedDefs.PostView> & {
    record?: Partial<AppBskyFeedPost.Record>;
    author?: Partial<AppBskyActorDefs.ProfileViewBasic>;
  }
): AppBskyFeedDefs.PostView {
  const author = createProfile(overrides?.author);
  const uri = overrides?.uri ?? createPostUri(author.did, `post${Date.now()}`);
  const record = createPostRecord(overrides?.record);

  return {
    uri,
    cid: overrides?.cid ?? `cid${Date.now()}`,
    author,
    record,
    indexedAt: overrides?.indexedAt ?? "2026-01-04T12:00:00.000Z",
    likeCount: overrides?.likeCount ?? 10,
    repostCount: overrides?.repostCount ?? 5,
    replyCount: overrides?.replyCount ?? 3,
    quoteCount: overrides?.quoteCount ?? 2,
    ...overrides,
  };
}

// Helper to create a feed view post (what getAuthorFeed returns)
export function createFeedViewPost(
  overrides?: Partial<Omit<AppBskyFeedDefs.FeedViewPost, "post">> & {
    post?: Partial<AppBskyFeedDefs.PostView> & {
      record?: Partial<AppBskyFeedPost.Record>;
      author?: Partial<AppBskyActorDefs.ProfileViewBasic>;
    };
  }
): AppBskyFeedDefs.FeedViewPost {
  const { post: postOverrides, ...restOverrides } = overrides ?? {};
  return {
    post: createPostView(postOverrides),
    ...restOverrides,
  };
}

// Create a post with facets (links and mentions)
export function createPostWithFacets(): AppBskyFeedDefs.FeedViewPost {
  const text =
    "Check out this link https://example.com and @mention.bsky.social";
  return createFeedViewPost({
    post: {
      record: {
        text,
        facets: [
          {
            index: { byteStart: 20, byteEnd: 39 },
            features: [
              {
                $type: "app.bsky.richtext.facet#link",
                uri: "https://example.com",
              },
            ],
          },
          {
            index: { byteStart: 44, byteEnd: 65 },
            features: [
              {
                $type: "app.bsky.richtext.facet#mention",
                did: createDid("mentioned"),
              },
            ],
          },
        ],
      },
    },
  });
}

// Create a post with an external embed (link preview)
export function createPostWithExternalEmbed(): AppBskyFeedDefs.FeedViewPost {
  const author = createProfile();
  const uri = createPostUri(author.did, "external1");
  return createFeedViewPost({
    post: {
      uri,
      author,
      record: {
        text: "Check out this article",
      },
      embed: {
        $type: "app.bsky.embed.external#view",
        external: {
          uri: "https://theonion.com/article",
          title: "Funny Article Title",
          description: "A hilarious description of the article content",
          thumb: "https://cdn.bsky.app/thumb/article.jpg",
        },
      },
    },
  });
}

// Create a post with images
export function createPostWithImages(
  imageCount: number = 1
): AppBskyFeedDefs.FeedViewPost {
  const images = Array.from({ length: imageCount }, (_, i) => ({
    thumb: `https://cdn.bsky.app/thumb/image${i}.jpg`,
    fullsize: `https://cdn.bsky.app/full/image${i}.jpg`,
    alt: `Image ${i} description`,
    aspectRatio: { width: 1000, height: 750 },
  }));

  return createFeedViewPost({
    post: {
      record: {
        text: `Post with ${imageCount} image(s)`,
      },
      embed: {
        $type: "app.bsky.embed.images#view",
        images,
      },
    },
  });
}

// Create a post with a video
export function createPostWithVideo(): AppBskyFeedDefs.FeedViewPost {
  return createFeedViewPost({
    post: {
      record: {
        text: "Check out this video",
      },
      embed: {
        $type: "app.bsky.embed.video#view",
        playlist: "https://video.bsky.app/watch/stream.m3u8",
        thumbnail: "https://cdn.bsky.app/thumb/video.jpg",
        alt: "Video description",
        aspectRatio: { width: 1920, height: 1080 },
      },
    },
  });
}

// Create a quoted post embed
export function createQuotedPostEmbed(
  quotedPost: AppBskyFeedDefs.PostView
): AppBskyFeedDefs.PostView["embed"] {
  const quotedRecord = quotedPost.record as AppBskyFeedPost.Record;
  return {
    $type: "app.bsky.embed.record#view",
    record: {
      $type: "app.bsky.embed.record#viewRecord",
      uri: quotedPost.uri,
      cid: quotedPost.cid,
      author: quotedPost.author,
      value: quotedRecord,
      indexedAt: quotedPost.indexedAt,
      embeds: quotedPost.embed ? [quotedPost.embed] : undefined,
      likeCount: quotedPost.likeCount,
      repostCount: quotedPost.repostCount,
      replyCount: quotedPost.replyCount,
      quoteCount: quotedPost.quoteCount,
    },
  };
}

// Create a post that quotes another post
export function createPostWithQuote(): AppBskyFeedDefs.FeedViewPost {
  const quotedPostView = createPostView({
    record: {
      text: "This is the original post being quoted",
    },
    likeCount: 50,
    repostCount: 20,
  });

  return createFeedViewPost({
    post: {
      record: {
        text: "My comment on this post",
      },
      embed: createQuotedPostEmbed(quotedPostView),
    },
  });
}

// Create a post with a quoted post that has an external embed
export function createPostWithQuotedExternalEmbed(): AppBskyFeedDefs.FeedViewPost {
  const quotedPostView = createPostView({
    record: {
      text: "Read this article",
    },
    embed: {
      $type: "app.bsky.embed.external#view",
      external: {
        uri: "https://news.example.com/story",
        title: "Breaking News Story",
        description: "Important news from around the world",
        thumb: "https://cdn.bsky.app/thumb/news.jpg",
      },
    },
    likeCount: 100,
    repostCount: 50,
  });

  return createFeedViewPost({
    post: {
      record: {
        text: "Commenting on this news",
      },
      embed: createQuotedPostEmbed(quotedPostView),
    },
  });
}

// Create a nested quote (quoted post that itself quotes another post)
export function createNestedQuotedPost(): AppBskyFeedDefs.FeedViewPost {
  // Innermost post
  const innerPost = createPostView({
    record: {
      text: "The original innermost post",
    },
    likeCount: 25,
  });

  // Middle post (quotes inner)
  const middlePost = createPostView({
    record: {
      text: "Quoting the original",
    },
    embed: createQuotedPostEmbed(innerPost),
    likeCount: 50,
  });

  // Outer post (quotes middle)
  return createFeedViewPost({
    post: {
      record: {
        text: "Meta comment on the quote",
      },
      embed: createQuotedPostEmbed(middlePost),
      likeCount: 75,
    },
  });
}

// Create a reply post
export function createReplyPost(): AppBskyFeedDefs.FeedViewPost {
  const parentAuthor = createProfile({ handle: "parent.bsky.social" });
  const parentUri = createPostUri(parentAuthor.did, "parent1");

  return createFeedViewPost({
    post: {
      record: {
        text: "This is a reply",
        reply: {
          root: { uri: parentUri, cid: "rootcid" },
          parent: { uri: parentUri, cid: "parentcid" },
        },
      },
    },
  });
}

// Create a repost
export function createRepost(): AppBskyFeedDefs.FeedViewPost {
  const originalAuthor = createProfile({ handle: "original.bsky.social" });
  const originalUri = createPostUri(originalAuthor.did, "original1");

  return createFeedViewPost({
    post: {
      uri: originalUri,
      author: originalAuthor,
      record: {
        $type: "app.bsky.feed.repost",
        subject: { uri: originalUri, cid: "originalcid" },
        createdAt: "2026-01-04T14:00:00.000Z",
      } as unknown as AppBskyFeedPost.Record,
    },
    reason: {
      $type: "app.bsky.feed.defs#reasonRepost",
      by: createProfile({ handle: "reposter.bsky.social" }),
      indexedAt: "2026-01-04T14:00:00.000Z",
    },
  });
}

// Create a post with varying engagement counts
export function createPostWithEngagement(counts: {
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  quoteCount?: number;
}): AppBskyFeedDefs.FeedViewPost {
  return createFeedViewPost({
    post: {
      record: {
        text: "Post with specific engagement",
      },
      likeCount: counts.likeCount ?? 0,
      repostCount: counts.repostCount ?? 0,
      replyCount: counts.replyCount ?? 0,
      quoteCount: counts.quoteCount ?? 0,
    },
  });
}

// Chat message fixtures

export interface MockChatMessage {
  id: string;
  rev: string;
  text: string;
  sentAt: string;
  sender: { did: string };
  facets?: unknown[];
  embed?: unknown;
  reactions?: unknown[];
}

export function createChatMessage(
  overrides?: Partial<MockChatMessage>
): MockChatMessage {
  return {
    id: overrides?.id ?? `msg${Date.now()}`,
    rev: overrides?.rev ?? "1",
    text: overrides?.text ?? "Hello, this is a test message",
    sentAt: overrides?.sentAt ?? "2026-01-04T12:00:00.000Z",
    sender: overrides?.sender ?? { did: createDid("sender") },
    facets: overrides?.facets,
    embed: overrides?.embed,
    reactions: overrides?.reactions,
  };
}

export function createChatMessageWithFacets(): MockChatMessage {
  return createChatMessage({
    text: "Check this link https://example.com",
    facets: [
      {
        index: { byteStart: 17, byteEnd: 36 },
        features: [
          {
            $type: "app.bsky.richtext.facet#link",
            uri: "https://example.com",
          },
        ],
      },
    ],
  });
}

export function createChatMessageWithEmbed(): MockChatMessage {
  const embeddedPost = createPostView({
    record: {
      text: "This post was shared in the chat",
    },
  });

  return createChatMessage({
    text: "Check out this post",
    embed: {
      $type: "app.bsky.embed.record#view",
      record: {
        uri: embeddedPost.uri,
        cid: embeddedPost.cid,
        author: embeddedPost.author,
        value: embeddedPost.record,
      },
    },
  });
}

export function createChatMessageWithReactions(): MockChatMessage {
  return createChatMessage({
    text: "Great news!",
    reactions: [
      { emoji: "👍", count: 3 },
      { emoji: "❤️", count: 1 },
    ],
  });
}

// Mock conversation
export interface MockConversation {
  id: string;
  rev: string;
  members: {
    did: string;
    handle?: string;
    displayName?: string;
    avatar?: string;
  }[];
  lastMessage?: {
    id: string;
    text: string;
    sentAt: string;
    sender: { did: string };
  };
  muted: boolean;
  unreadCount: number;
}

export function createConversation(
  overrides?: Partial<MockConversation>
): MockConversation {
  const member1Did = createDid("member1");
  const member2Did = createDid("member2");

  return {
    id: overrides?.id ?? `convo${Date.now()}`,
    rev: overrides?.rev ?? "1",
    members: overrides?.members ?? [
      {
        did: member1Did,
        handle: "member1.bsky.social",
        displayName: "Member One",
        avatar: "https://cdn.bsky.app/avatar/member1.jpg",
      },
      {
        did: member2Did,
        handle: "member2.bsky.social",
        displayName: "Member Two",
        avatar: "https://cdn.bsky.app/avatar/member2.jpg",
      },
    ],
    lastMessage: overrides?.lastMessage ?? {
      id: "lastmsg1",
      text: "See you later!",
      sentAt: "2026-01-04T15:00:00.000Z",
      sender: { did: member2Did },
    },
    muted: overrides?.muted ?? false,
    unreadCount: overrides?.unreadCount ?? 0,
  };
}

// Create getAuthorFeed response
export function createAuthorFeedResponse(
  feed: AppBskyFeedDefs.FeedViewPost[],
  cursor?: string
): { feed: AppBskyFeedDefs.FeedViewPost[]; cursor?: string } {
  return { feed, cursor };
}

// Create getLikes response
export function createLikesResponse(
  feed: AppBskyFeedDefs.FeedViewPost[],
  cursor?: string
): { feed: AppBskyFeedDefs.FeedViewPost[]; cursor?: string } {
  return { feed, cursor };
}

// Create getBookmarks response
export function createBookmarksResponse(
  bookmarks: AppBskyFeedDefs.PostView[],
  cursor?: string
): { bookmarks: AppBskyFeedDefs.PostView[]; cursor?: string } {
  return { bookmarks, cursor };
}

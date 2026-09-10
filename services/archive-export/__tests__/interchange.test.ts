import type { ResolvedAsset } from "../assets";
import { previewAssetKey } from "../assets";
import {
  translateBlueskyAccountToInterchange,
  type BlueskyArchiveTranslationContext,
  type BlueskyInterchangeContent,
} from "../interchange";
import type {
  MobileAccountSnapshot,
  MobileBookmarkRow,
  MobileConversationRow,
  MobileFollowRow,
  MobileMessageRow,
  MobilePostRow,
  MobileProfileRow,
} from "../mobile-snapshot";

const ACCOUNT_DID = "did:plc:alice";
const ACCOUNT_UUID = "018d5f7a-9b3c-7d10-8a2e-1f4c6b8d0e12";
const OTHER_DID = "did:plc:bob";
const SAVED_AT = Date.UTC(2026, 8, 1, 12, 0, 0);
const EXPORTED_AT = new Date("2026-09-10T00:00:00.000Z");

function profile(overrides: Partial<MobileProfileRow> = {}): MobileProfileRow {
  return {
    did: ACCOUNT_DID,
    handle: "alice.example",
    displayName: "Alice",
    savedAt: SAVED_AT,
    updatedAt: SAVED_AT,
    ...overrides,
  };
}

function post(overrides: Partial<MobilePostRow> = {}): MobilePostRow {
  return {
    uri: `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
    cid: "bafypost",
    authorDid: ACCOUNT_DID,
    text: "Hello",
    facetsJSON: null,
    embedJSON: null,
    langs: "en",
    isReply: 0,
    replyParentUri: null,
    replyRootUri: null,
    isQuote: 0,
    quotedPostUri: null,
    isRepost: 0,
    repostUri: null,
    repostCid: null,
    originalPostUri: null,
    likeCount: 2,
    repostCount: 1,
    replyCount: 0,
    quoteCount: 0,
    viewerLiked: 0,
    viewerReposted: 0,
    viewerBookmarked: 0,
    createdAt: "2026-08-30T09:00:00.000Z",
    savedAt: SAVED_AT,
    deletedPostAt: null,
    deletedRepostAt: null,
    deletedLikeAt: null,
    deletedBookmarkAt: null,
    likeUri: null,
    ...overrides,
  };
}

function bookmark(overrides: Partial<MobileBookmarkRow> = {}): MobileBookmarkRow {
  return {
    subjectUri: `at://${OTHER_DID}/app.bsky.feed.post/bookmarked`,
    postAuthorDid: OTHER_DID,
    postAuthorHandle: "bob.example",
    postText: "Bookmarked post",
    postCreatedAt: "2026-08-20T09:00:00.000Z",
    savedAt: SAVED_AT,
    deletedAt: null,
    ...overrides,
  };
}

function follow(overrides: Partial<MobileFollowRow> = {}): MobileFollowRow {
  return {
    uri: `at://${ACCOUNT_DID}/app.bsky.graph.follow/bob`,
    subjectDid: OTHER_DID,
    handle: "bob.example",
    createdAt: "2026-07-01T09:00:00.000Z",
    savedAt: SAVED_AT,
    unfollowedAt: null,
    ...overrides,
  };
}

function conversation(
  overrides: Partial<MobileConversationRow> = {},
): MobileConversationRow {
  return {
    convoId: "convo-1",
    rev: "rev-1",
    memberDids: JSON.stringify([ACCOUNT_DID, OTHER_DID]),
    savedAt: SAVED_AT,
    updatedAt: SAVED_AT,
    leftAt: null,
    ...overrides,
  };
}

function message(overrides: Partial<MobileMessageRow> = {}): MobileMessageRow {
  return {
    messageId: "message-1",
    convoId: "convo-1",
    rev: "rev-1",
    senderDid: OTHER_DID,
    text: "Hi there",
    facetsJSON: null,
    embedJSON: null,
    sentAt: "2026-08-31T09:00:00.000Z",
    savedAt: SAVED_AT,
    deletedAt: null,
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<MobileAccountSnapshot> = {},
): MobileAccountSnapshot {
  return {
    profiles: [profile()],
    posts: [],
    postMedia: [],
    postExternals: [],
    bookmarks: [],
    follows: [],
    conversations: [],
    messages: [],
    mediaAssets: [],
    ...overrides,
  };
}

function availableAsset(key: string, sha256 = "a".repeat(64)): ResolvedAsset {
  return {
    key,
    availability: "available",
    sha256,
    byteCount: 1024,
    crc32: 7,
    sniffedMediaType: "image/jpeg",
    archivePath: `media/sha256/${sha256.slice(0, 2)}/${sha256}`,
    localPath: `file:///accounts/media/${key}`,
  };
}

function translate(
  input: MobileAccountSnapshot,
  context: Partial<BlueskyArchiveTranslationContext> = {},
): BlueskyInterchangeContent {
  return translateBlueskyAccountToInterchange(input, {
    accountDid: ACCOUNT_DID,
    accountUuid: ACCOUNT_UUID,
    createdAt: EXPORTED_AT,
    assets: new Map(),
    portableSettings: {},
    ...context,
  });
}

describe("translateBlueskyAccountToInterchange", () => {
  it("describes the archive and the identity it belongs to", () => {
    const content = translate(snapshot());

    expect(content.archive).toEqual({
      format: "cyd-archive",
      platform: "bluesky",
      version: 2,
      created_at: "2026-09-10T00:00:00.000Z",
      account_did: ACCOUNT_DID,
      account_uuid: ACCOUNT_UUID,
      completeness: "complete",
    });
    expect(content.identity).toEqual({
      did: ACCOUNT_DID,
      current_profile_id: `profile:${ACCOUNT_DID}`,
    });
    expect(content.profiles).toEqual([
      {
        id: `profile:${ACCOUNT_DID}`,
        did: ACCOUNT_DID,
        handle: "alice.example",
        display_name: "Alice",
        description: null,
        avatar_asset_id: null,
        banner_asset_id: null,
        captured_at: "2026-09-01T12:00:00.000Z",
      },
    ]);
  });

  it("gives the account an identity even before any profile was captured", () => {
    const content = translate(snapshot({ profiles: [] }));

    expect(content.identity.current_profile_id).toBe(`profile:${ACCOUNT_DID}`);
    expect(content.profiles).toEqual([
      expect.objectContaining({ did: ACCOUNT_DID, handle: null }),
    ]);
  });

  it("translates a saved post with its text, facets, and observation times", () => {
    const content = translate(
      snapshot({
        posts: [
          post({
            facetsJSON: '[{"index":{"byteStart":0,"byteEnd":5}}]',
            langs: "en,fr",
          }),
        ],
      }),
    );

    expect(content.records).toEqual([
      expect.objectContaining({
        uri: `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
        cid: "bafypost",
        record_type: "app.bsky.feed.post",
        author_profile_id: `profile:${ACCOUNT_DID}`,
        indexed_at: null,
        created_at: "2026-08-30T09:00:00.000Z",
        first_observed_at: "2026-09-01T12:00:00.000Z",
        observed_at: "2026-09-01T12:00:00.000Z",
        source_deleted_at: null,
        text: "Hello",
        facets_json: '[{"index":{"byteStart":0,"byteEnd":5}}]',
      }),
    ]);
    expect(JSON.parse(content.records[0].payload_json)).toEqual({
      record: {
        $type: "app.bsky.feed.post",
        text: "Hello",
        createdAt: "2026-08-30T09:00:00.000Z",
        langs: ["en", "fr"],
      },
      metrics: { likeCount: 2, repostCount: 1, replyCount: 0, quoteCount: 0 },
    });
    expect(content.selections).toEqual([
      {
        category: "posts",
        subject_id: `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
        selected_at: "2026-09-01T12:00:00.000Z",
      },
    ]);
  });

  it("keeps the deletion state Bluesky's source no longer has", () => {
    const deletedAt = Date.UTC(2026, 8, 5, 0, 0, 0);
    const content = translate(
      snapshot({
        posts: [post({ deletedPostAt: deletedAt })],
        follows: [follow({ unfollowedAt: deletedAt })],
        conversations: [conversation({ leftAt: deletedAt })],
        messages: [message({ deletedAt })],
      }),
    );

    expect(content.records[0].source_deleted_at).toBe("2026-09-05T00:00:00.000Z");
    expect(content.relationships[0].source_deleted_at).toBe(
      "2026-09-05T00:00:00.000Z",
    );
    expect(content.conversations[0].source_deleted_at).toBe(
      "2026-09-05T00:00:00.000Z",
    );
    expect(content.messages[0].source_deleted_at).toBe(
      "2026-09-05T00:00:00.000Z",
    );
  });

  it("links a like to the record it is about", () => {
    const likeUri = `at://${ACCOUNT_DID}/app.bsky.feed.like/one`;
    const content = translate(
      snapshot({
        posts: [
          post({
            uri: `at://${OTHER_DID}/app.bsky.feed.post/liked`,
            authorDid: OTHER_DID,
            viewerLiked: 1,
            likeUri,
          }),
        ],
        profiles: [profile(), profile({ did: OTHER_DID, handle: "bob.example" })],
      }),
    );

    expect(
      content.records.find((record) => record.uri === likeUri),
    ).toEqual(
      expect.objectContaining({
        record_type: "app.bsky.feed.like",
        author_profile_id: `profile:${ACCOUNT_DID}`,
        text: null,
      }),
    );
    expect(content.recordSubjects).toEqual([
      {
        relationship_uri: likeUri,
        subject_record_uri: `at://${OTHER_DID}/app.bsky.feed.post/liked`,
      },
    ]);
    expect(content.selections).toContainEqual(
      expect.objectContaining({ category: "likes", subject_id: likeUri }),
    );
  });

  it("links a repost to the record it is about", () => {
    const repostUri = `at://${ACCOUNT_DID}/app.bsky.feed.repost/one`;
    const content = translate(
      snapshot({
        posts: [
          post({
            uri: `at://${OTHER_DID}/app.bsky.feed.post/reposted`,
            authorDid: OTHER_DID,
            viewerReposted: 1,
            repostUri,
          }),
        ],
        profiles: [profile(), profile({ did: OTHER_DID, handle: "bob.example" })],
      }),
    );

    expect(
      content.records.find((record) => record.uri === repostUri)?.record_type,
    ).toBe("app.bsky.feed.repost");
    expect(content.recordSubjects).toEqual([
      {
        relationship_uri: repostUri,
        subject_record_uri: `at://${OTHER_DID}/app.bsky.feed.post/reposted`,
      },
    ]);
    expect(content.selections).toContainEqual(
      expect.objectContaining({ category: "reposts", subject_id: repostUri }),
    );
  });

  it("says a repost once, however many ways Cyd saw it", () => {
    // An account feed can carry the repost as a record of its own *and* as
    // viewer state on the post it points at. Both describe one repost, and the
    // interchange keys would collide if the export said it twice.
    const repostUri = `at://${ACCOUNT_DID}/app.bsky.feed.repost/one`;
    const repostedUri = `at://${OTHER_DID}/app.bsky.feed.post/reposted`;
    const content = translate(
      snapshot({
        profiles: [profile(), profile({ did: OTHER_DID, handle: "bob.example" })],
        posts: [
          post({
            uri: repostUri,
            cid: "bafyrepost",
            isRepost: 1,
            originalPostUri: repostedUri,
            text: "",
            createdAt: "2026-08-31T09:00:00.000Z",
          }),
          post({
            uri: repostedUri,
            authorDid: OTHER_DID,
            viewerReposted: 1,
            repostUri,
          }),
        ],
      }),
    );

    expect(
      content.selections.filter((row) => row.category === "reposts"),
    ).toEqual([expect.objectContaining({ subject_id: repostUri })]);
    expect(content.recordSubjects).toEqual([
      { relationship_uri: repostUri, subject_record_uri: repostedUri },
    ]);
    // The saved repost record keeps its own CID and creation time.
    expect(content.records.find((record) => record.uri === repostUri)).toEqual(
      expect.objectContaining({
        cid: "bafyrepost",
        created_at: "2026-08-31T09:00:00.000Z",
      }),
    );
  });

  it("selects a bookmark and keeps the post it points at", () => {
    const content = translate(snapshot({ bookmarks: [bookmark()] }));

    expect(content.selections).toEqual([
      expect.objectContaining({
        category: "bookmarks",
        subject_id: `at://${OTHER_DID}/app.bsky.feed.post/bookmarked`,
      }),
    ]);
    expect(content.records).toEqual([
      expect.objectContaining({
        uri: `at://${OTHER_DID}/app.bsky.feed.post/bookmarked`,
        text: "Bookmarked post",
        created_at: "2026-08-20T09:00:00.000Z",
        author_profile_id: `profile:${OTHER_DID}`,
      }),
    ]);
  });

  it("captures the reply parent, quote, and external context of a post", () => {
    const parentUri = `at://${OTHER_DID}/app.bsky.feed.post/parent`;
    const quotedUri = `at://${OTHER_DID}/app.bsky.feed.post/quoted`;
    const content = translate(
      snapshot({
        profiles: [profile(), profile({ did: OTHER_DID, handle: "bob.example" })],
        posts: [
          post({
            isReply: 1,
            replyParentUri: parentUri,
            replyRootUri: parentUri,
            isQuote: 1,
            quotedPostUri: quotedUri,
          }),
          post({
            uri: parentUri,
            authorDid: OTHER_DID,
            text: "Parent",
            viewerLiked: 1,
            likeUri: `at://${ACCOUNT_DID}/app.bsky.feed.like/parent`,
          }),
          post({ uri: quotedUri, authorDid: OTHER_DID, text: "Quoted" }),
        ],
        postExternals: [
          {
            postUri: `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
            uri: "https://example.com/story",
            title: "A story",
            description: "About something",
            thumbUrl: "https://cdn.example/thumb.jpg",
          },
        ],
      }),
    );

    const context = content.recordContext.filter(
      (row) => row.record_uri === `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
    );
    expect(context).toEqual([
      {
        record_uri: `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
        kind: "reply_parent",
        context_record_uri: parentUri,
        context_profile_id: `profile:${OTHER_DID}`,
        external_json: null,
      },
      {
        record_uri: `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
        kind: "quote",
        context_record_uri: quotedUri,
        context_profile_id: `profile:${OTHER_DID}`,
        external_json: null,
      },
      {
        record_uri: `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
        kind: "external",
        context_record_uri: null,
        context_profile_id: null,
        external_json: JSON.stringify({
          uri: "https://example.com/story",
          title: "A story",
          description: "About something",
          thumbUrl: "https://cdn.example/thumb.jpg",
        }),
      },
    ]);
  });

  it("keeps the author of context Cyd never saved, which the URI still names", () => {
    const parentUri = `at://${OTHER_DID}/app.bsky.feed.post/unsaved`;
    const content = translate(
      snapshot({
        posts: [post({ isReply: 1, replyParentUri: parentUri })],
      }),
    );

    expect(content.recordContext).toEqual([
      {
        record_uri: `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
        kind: "reply_parent",
        context_record_uri: null,
        context_profile_id: `profile:${OTHER_DID}`,
        external_json: null,
      },
    ]);
    expect(content.profiles).toContainEqual(
      expect.objectContaining({ id: `profile:${OTHER_DID}`, handle: null }),
    );
    expect(content.records.map((record) => record.uri)).not.toContain(parentUri);
  });

  it("packages a repeated asset once and points every use at it", () => {
    const content = translate(
      snapshot({
        posts: [
          post(),
          post({ uri: `at://${ACCOUNT_DID}/app.bsky.feed.post/two` }),
        ],
        postMedia: [
          {
            postUri: `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
            position: 0,
            mediaType: "image",
            alt: "A picture",
            width: 800,
            height: 600,
            assetCid: "bafyimage",
          },
          {
            postUri: `at://${ACCOUNT_DID}/app.bsky.feed.post/two`,
            position: 0,
            mediaType: "image",
            alt: "A picture",
            width: 800,
            height: 600,
            assetCid: "bafyimage",
          },
        ],
        mediaAssets: [
          {
            contentCid: "bafyimage",
            mediaType: "image",
            mimeType: "image/jpeg",
            sourceUrl: "https://cdn.example/image",
            sourceMetadataJSON: null,
            downloadState: "complete",
            lastError: null,
          },
        ],
      }),
      { assets: new Map([["bafyimage", availableAsset("bafyimage")]]) },
    );

    expect(content.assets).toEqual([
      {
        id: "bafyimage",
        kind: "image",
        media_type: "image/jpeg",
        byte_count: 1024,
        sha256: "a".repeat(64),
        archive_path: `media/sha256/aa/${"a".repeat(64)}`,
        availability: "available",
        unavailable_reason: null,
        source_url: "https://cdn.example/image",
        width: 800,
        height: 600,
        alt_text: "A picture",
      },
    ]);
    expect(content.recordAssets).toEqual([
      {
        owner_type: "record",
        owner_id: `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
        asset_id: "bafyimage",
        role: "content",
        position: 0,
      },
      {
        owner_type: "record",
        owner_id: `at://${ACCOUNT_DID}/app.bsky.feed.post/two`,
        asset_id: "bafyimage",
        role: "content",
        position: 0,
      },
    ]);
    expect(content.payloads).toEqual([
      expect.objectContaining({ archivePath: `media/sha256/aa/${"a".repeat(64)}` }),
    ]);
  });

  it("collapses two assets whose bytes turned out to be identical", () => {
    const digest = "b".repeat(64);
    const content = translate(
      snapshot({
        posts: [post()],
        postMedia: [
          {
            postUri: `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
            position: 0,
            mediaType: "image",
            alt: null,
            width: null,
            height: null,
            assetCid: "bafyone",
          },
          {
            postUri: `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
            position: 1,
            mediaType: "image",
            alt: null,
            width: null,
            height: null,
            assetCid: "bafytwo",
          },
        ],
        mediaAssets: [
          {
            contentCid: "bafyone",
            mediaType: "image",
            mimeType: "image/jpeg",
            sourceUrl: null,
            sourceMetadataJSON: null,
            downloadState: "complete",
            lastError: null,
          },
          {
            contentCid: "bafytwo",
            mediaType: "image",
            mimeType: "image/jpeg",
            sourceUrl: null,
            sourceMetadataJSON: null,
            downloadState: "complete",
            lastError: null,
          },
        ],
      }),
      {
        assets: new Map([
          ["bafyone", availableAsset("bafyone", digest)],
          ["bafytwo", availableAsset("bafytwo", digest)],
        ]),
      },
    );

    expect(content.assets).toHaveLength(1);
    expect(content.payloads).toHaveLength(1);
    expect(content.recordAssets.map((row) => row.asset_id)).toEqual([
      "bafyone",
      "bafyone",
    ]);
  });

  it("says an asset Cyd never finished downloading is missing, not gone", () => {
    const content = translate(
      snapshot({
        posts: [post()],
        postMedia: [
          {
            postUri: `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
            position: 0,
            mediaType: "video",
            alt: null,
            width: 1280,
            height: 720,
            assetCid: "bafyvideo",
          },
        ],
        mediaAssets: [
          {
            contentCid: "bafyvideo",
            mediaType: "video",
            mimeType: null,
            sourceUrl: "https://cdn.example/video",
            sourceMetadataJSON: null,
            downloadState: "failed",
            lastError: "Network error",
          },
        ],
      }),
      {
        assets: new Map<string, ResolvedAsset>([
          [
            "bafyvideo",
            {
              key: "bafyvideo",
              availability: "missing",
              reason:
                "Cyd has not finished preserving this file, so it could not be included.",
            },
          ],
        ]),
      },
    );

    expect(content.assets).toEqual([
      expect.objectContaining({
        id: "bafyvideo",
        kind: "video",
        media_type: "video/mp4",
        availability: "missing",
        unavailable_reason:
          "Cyd has not finished preserving this file, so it could not be included.",
        byte_count: null,
        sha256: null,
        archive_path: null,
      }),
    ]);
    expect(content.recordAssets).toHaveLength(1);
    expect(content.payloads).toEqual([]);
    expect(content.completeness).toBe("incomplete");
  });

  it("packages the thumbnail of a link preview Cyd preserved", () => {
    const key = previewAssetKey(`at://${ACCOUNT_DID}/app.bsky.feed.post/one`);
    const content = translate(
      snapshot({
        posts: [post()],
        postExternals: [
          {
            postUri: `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
            uri: "https://example.com/story",
            title: "A story",
            description: null,
            thumbUrl: "https://cdn.example/thumb.jpg",
          },
        ],
      }),
      { assets: new Map([[key, availableAsset(key, "c".repeat(64))]]) },
    );

    expect(content.assets).toEqual([
      expect.objectContaining({
        id: key,
        kind: "preview",
        media_type: "image/jpeg",
        availability: "available",
        source_url: "https://cdn.example/thumb.jpg",
      }),
    ]);
    expect(content.recordAssets).toEqual([
      {
        owner_type: "record",
        owner_id: `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
        asset_id: key,
        role: "preview",
        position: 0,
      },
    ]);
    expect(content.payloads).toHaveLength(1);
  });

  it("leaves a link preview Cyd never downloaded out of the assets entirely", () => {
    // Mobile does not count an undownloaded link thumbnail as part of its
    // Bluesky saved data, so its absence must not make the archive incomplete.
    // The URL survives in the record's external context.
    const content = translate(
      snapshot({
        posts: [post()],
        postExternals: [
          {
            postUri: `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
            uri: "https://example.com/story",
            title: "A story",
            description: null,
            thumbUrl: "https://cdn.example/thumb.jpg",
          },
        ],
      }),
    );

    expect(content.assets).toEqual([]);
    expect(content.recordAssets).toEqual([]);
    expect(content.completeness).toBe("complete");
    expect(JSON.parse(content.recordContext[0].external_json!)).toMatchObject({
      thumbUrl: "https://cdn.example/thumb.jpg",
    });
  });

  it("drops a subject link to a record the archive does not contain", () => {
    // record_subjects.subject_record_uri is a foreign key: a repost of a post
    // Cyd never saved must cost that one link, not the whole export.
    const repostUri = `at://${ACCOUNT_DID}/app.bsky.feed.repost/one`;
    const content = translate(
      snapshot({
        posts: [
          post({
            uri: repostUri,
            isRepost: 1,
            originalPostUri: `at://${OTHER_DID}/app.bsky.feed.post/never-saved`,
            text: "",
          }),
        ],
      }),
    );

    expect(content.recordSubjects).toEqual([]);
    expect(content.selections).toEqual([
      expect.objectContaining({ category: "reposts", subject_id: repostUri }),
    ]);
    expect(JSON.parse(content.records[0].payload_json).record.subject).toEqual({
      uri: `at://${OTHER_DID}/app.bsky.feed.post/never-saved`,
    });
  });

  it("never selects a bookmark it cannot describe", () => {
    const content = translate(
      snapshot({
        bookmarks: [
          bookmark({ subjectUri: "not-an-at-uri", postAuthorDid: null }),
        ],
      }),
    );

    expect(content.selections).toEqual([]);
    expect(content.records).toEqual([]);
  });

  it("leaves out an asset no exported record refers to", () => {
    const content = translate(
      snapshot({
        mediaAssets: [
          {
            contentCid: "bafyorphan",
            mediaType: "image",
            mimeType: "image/jpeg",
            sourceUrl: null,
            sourceMetadataJSON: null,
            downloadState: "complete",
            lastError: null,
          },
        ],
      }),
      { assets: new Map([["bafyorphan", availableAsset("bafyorphan")]]) },
    );

    expect(content.assets).toEqual([]);
    expect(content.payloads).toEqual([]);
    expect(content.completeness).toBe("complete");
  });

  it("translates a conversation, who was in it, and what was said", () => {
    const content = translate(
      snapshot({
        profiles: [profile(), profile({ did: OTHER_DID, handle: "bob.example" })],
        conversations: [conversation()],
        messages: [message()],
      }),
    );

    expect(content.conversations).toEqual([
      {
        id: "convo-1",
        rev: "rev-1",
        first_observed_at: "2026-09-01T12:00:00.000Z",
        observed_at: "2026-09-01T12:00:00.000Z",
        source_deleted_at: null,
      },
    ]);
    expect(content.conversationMembers).toEqual([
      { conversation_id: "convo-1", profile_id: `profile:${ACCOUNT_DID}` },
      { conversation_id: "convo-1", profile_id: `profile:${OTHER_DID}` },
    ]);
    expect(content.messages).toEqual([
      expect.objectContaining({
        id: "message-1",
        conversation_id: "convo-1",
        sender_profile_id: `profile:${OTHER_DID}`,
        sent_at: "2026-08-31T09:00:00.000Z",
        text: "Hi there",
      }),
    ]);
    expect(content.selections).toContainEqual(
      expect.objectContaining({ category: "chats", subject_id: "convo-1" }),
    );
  });

  it("translates follows as relationships", () => {
    const content = translate(snapshot({ follows: [follow()] }));

    expect(content.relationships).toEqual([
      {
        uri: `at://${ACCOUNT_DID}/app.bsky.graph.follow/bob`,
        kind: "follow",
        actor_did: ACCOUNT_DID,
        subject_did: OTHER_DID,
        created_at: "2026-07-01T09:00:00.000Z",
        observed_at: "2026-09-01T12:00:00.000Z",
        source_deleted_at: null,
      },
    ]);
  });

  it("carries portable settings as canonical JSON values", () => {
    const content = translate(snapshot(), {
      portableSettings: { save_posts: true, delete_likes: false },
    });

    expect(content.portableSettings).toEqual([
      { key: "delete_likes", value_json: "false" },
      { key: "save_posts", value_json: "true" },
    ]);
  });

  it("never carries Mobile's private storage into the interchange", () => {
    const content = translate(
      snapshot({
        posts: [post()],
        postMedia: [
          {
            postUri: `at://${ACCOUNT_DID}/app.bsky.feed.post/one`,
            position: 0,
            mediaType: "image",
            alt: null,
            width: null,
            height: null,
            assetCid: "bafyimage",
          },
        ],
        mediaAssets: [
          {
            contentCid: "bafyimage",
            mediaType: "image",
            mimeType: "image/jpeg",
            sourceUrl: "https://cdn.example/image",
            sourceMetadataJSON: null,
            downloadState: "complete",
            lastError: null,
          },
        ],
      }),
      { assets: new Map([["bafyimage", availableAsset("bafyimage")]]) },
    );

    const serialized = JSON.stringify({
      ...content,
      payloads: undefined,
    });
    expect(serialized).not.toContain("file://");
    expect(serialized).not.toContain("localPath");
    expect(serialized).not.toContain("/accounts/");
  });
});

import {
  translateInterchangeToMobileRows,
  type BlueskyInterchangeSnapshot,
  type RestoredAssetPlacement,
} from "..";

const ACCOUNT_DID = "did:plc:owner";
const OTHER_DID = "did:plc:other";
const OBSERVED = "2026-09-11T16:28:28.691Z";

function profileId(did: string): string {
  return `profile:${did}`;
}

function emptySnapshot(): BlueskyInterchangeSnapshot {
  return {
    archive: {
      created_at: "2026-09-11T16:41:02.492Z",
      account_did: ACCOUNT_DID,
      account_uuid: "b67bfc6c-6155-47ef-8273-71593e04f01a",
      completeness: "complete",
    },
    identity: { did: ACCOUNT_DID, current_profile_id: profileId(ACCOUNT_DID) },
    profiles: [
      {
        id: profileId(ACCOUNT_DID),
        did: ACCOUNT_DID,
        handle: "owner.bsky.social",
        display_name: "Owner",
        avatar_asset_id: null,
        banner_asset_id: null,
        captured_at: OBSERVED,
      },
    ],
    records: [],
    selections: [],
    recordSubjects: [],
    recordContext: [],
    conversations: [],
    conversationMembers: [],
    messages: [],
    relationships: [],
    assets: [],
    recordAssets: [],
    portableSettings: [],
  };
}

function postRecord(
  uri: string,
  overrides: Partial<BlueskyInterchangeSnapshot["records"][number]> = {},
): BlueskyInterchangeSnapshot["records"][number] {
  return {
    uri,
    cid: "bafypost",
    record_type: "app.bsky.feed.post",
    author_profile_id: profileId(ACCOUNT_DID),
    indexed_at: null,
    created_at: "2026-09-10T22:21:30.301Z",
    first_observed_at: OBSERVED,
    observed_at: OBSERVED,
    source_deleted_at: null,
    text: "Hello",
    facets_json: null,
    payload_json: JSON.stringify({
      record: { $type: "app.bsky.feed.post", text: "Hello", createdAt: "2026-09-10T22:21:30.301Z" },
      metrics: { likeCount: 3, repostCount: 2, replyCount: 1, quoteCount: 0 },
    }),
    ...overrides,
  };
}

const OWN_POST = "at://did:plc:owner/app.bsky.feed.post/aaa";
const OTHER_POST = "at://did:plc:other/app.bsky.feed.post/bbb";

function translate(
  snapshot: BlueskyInterchangeSnapshot,
  placements: RestoredAssetPlacement[] = [],
) {
  return translateInterchangeToMobileRows(snapshot, {
    placements: new Map(placements.map((placement) => [placement.assetId, placement])),
  });
}

describe("translating a Cyd Bluesky archive into Mobile's rows", () => {
  it("keeps a post's own representation, metrics, and observation time", () => {
    const snapshot = emptySnapshot();
    snapshot.records = [postRecord(OWN_POST)];
    snapshot.selections = [
      { category: "posts", subject_id: OWN_POST, selected_at: OBSERVED },
    ];

    const { posts } = translate(snapshot);

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      uri: OWN_POST,
      cid: "bafypost",
      authorDid: ACCOUNT_DID,
      text: "Hello",
      isRepost: 0,
      likeCount: 3,
      repostCount: 2,
      replyCount: 1,
      quoteCount: 0,
      createdAt: "2026-09-10T22:21:30.301Z",
      savedAt: Date.parse(OBSERVED),
      deletedPostAt: null,
    });
  });

  it("carries source-deletion state onto the record it belongs to", () => {
    const snapshot = emptySnapshot();
    snapshot.records = [
      postRecord(OWN_POST, { source_deleted_at: "2026-09-12T09:00:00.000Z" }),
    ];
    snapshot.selections = [
      { category: "posts", subject_id: OWN_POST, selected_at: OBSERVED },
    ];

    const { posts } = translate(snapshot);

    expect(posts[0].deletedPostAt).toBe(Date.parse("2026-09-12T09:00:00.000Z"));
  });

  it("restores a like as the viewer state that makes the post browseable", () => {
    const likeUri = "at://did:plc:owner/app.bsky.feed.like/lll";
    const snapshot = emptySnapshot();
    snapshot.records = [
      postRecord(OWN_POST),
      {
        ...postRecord(likeUri),
        record_type: "app.bsky.feed.like",
        cid: null,
        text: null,
        source_deleted_at: "2026-09-12T09:00:00.000Z",
        payload_json: JSON.stringify({
          record: { $type: "app.bsky.feed.like", subject: { uri: OWN_POST } },
        }),
      },
    ];
    snapshot.recordSubjects = [
      { relationship_uri: likeUri, subject_record_uri: OWN_POST },
    ];
    snapshot.selections = [
      { category: "likes", subject_id: likeUri, selected_at: OBSERVED },
    ];

    const { posts } = translate(snapshot);

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      uri: OWN_POST,
      viewerLiked: 1,
      likeUri,
      deletedLikeAt: Date.parse("2026-09-12T09:00:00.000Z"),
    });
  });

  it("restores a like whose own URI the archive never knew", () => {
    const snapshot = emptySnapshot();
    snapshot.records = [postRecord(OWN_POST)];
    snapshot.selections = [
      { category: "likes", subject_id: OWN_POST, selected_at: OBSERVED },
    ];

    const { posts } = translate(snapshot);

    expect(posts[0]).toMatchObject({ viewerLiked: 1, likeUri: null });
  });

  it("restores a repost as viewer state on the post it points at", () => {
    const repostUri = "at://did:plc:owner/app.bsky.feed.repost/rrr";
    const snapshot = emptySnapshot();
    snapshot.records = [
      postRecord(OWN_POST),
      {
        ...postRecord(repostUri),
        record_type: "app.bsky.feed.repost",
        cid: "bafyrepost",
        text: null,
        payload_json: JSON.stringify({
          record: { $type: "app.bsky.feed.repost", subject: { uri: OWN_POST } },
        }),
      },
    ];
    snapshot.recordSubjects = [
      { relationship_uri: repostUri, subject_record_uri: OWN_POST },
    ];
    snapshot.selections = [
      { category: "reposts", subject_id: repostUri, selected_at: OBSERVED },
    ];

    const { posts } = translate(snapshot);

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      uri: OWN_POST,
      viewerReposted: 1,
      repostUri,
      repostCid: "bafyrepost",
      isRepost: 0,
    });
  });

  it("restores a repost of a post the archive does not carry as a repost of its own", () => {
    const repostUri = "at://did:plc:owner/app.bsky.feed.repost/rrr";
    const snapshot = emptySnapshot();
    snapshot.records = [
      {
        ...postRecord(repostUri),
        record_type: "app.bsky.feed.repost",
        text: null,
        payload_json: JSON.stringify({
          record: { $type: "app.bsky.feed.repost", subject: { uri: OTHER_POST } },
        }),
      },
    ];
    snapshot.selections = [
      { category: "reposts", subject_id: repostUri, selected_at: OBSERVED },
    ];

    const { posts } = translate(snapshot);

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      uri: repostUri,
      isRepost: 1,
      viewerReposted: 1,
      repostUri,
      originalPostUri: OTHER_POST,
    });
  });

  it("restores a bookmark as both a bookmark and browseable viewer state", () => {
    const snapshot = emptySnapshot();
    snapshot.records = [
      postRecord(OTHER_POST, { author_profile_id: profileId(OTHER_DID) }),
    ];
    snapshot.profiles.push({
      id: profileId(OTHER_DID),
      did: OTHER_DID,
      handle: "other.bsky.social",
      display_name: null,
      avatar_asset_id: null,
      banner_asset_id: null,
      captured_at: OBSERVED,
    });
    snapshot.selections = [
      { category: "bookmarks", subject_id: OTHER_POST, selected_at: OBSERVED },
    ];

    const { posts, bookmarks } = translate(snapshot);

    expect(posts[0]).toMatchObject({ uri: OTHER_POST, viewerBookmarked: 1 });
    expect(bookmarks).toEqual([
      expect.objectContaining({
        subjectUri: OTHER_POST,
        postAuthorDid: OTHER_DID,
        postAuthorHandle: "other.bsky.social",
        postText: "Hello",
        savedAt: Date.parse(OBSERVED),
      }),
    ]);
  });

  it("restores the bounded context a record needs to render", () => {
    const snapshot = emptySnapshot();
    snapshot.records = [
      postRecord(OWN_POST, {
        payload_json: JSON.stringify({
          record: {
            $type: "app.bsky.feed.post",
            text: "Hello",
            createdAt: "2026-09-10T22:21:30.301Z",
            reply: { parent: { uri: OTHER_POST }, root: { uri: OTHER_POST } },
          },
          embed: { $type: "app.bsky.embed.record#view", record: { uri: OTHER_POST } },
        }),
      }),
    ];
    snapshot.recordContext = [
      {
        record_uri: OWN_POST,
        kind: "reply_parent",
        context_record_uri: null,
        context_profile_id: profileId(OTHER_DID),
        external_json: null,
      },
      {
        record_uri: OWN_POST,
        kind: "quote",
        context_record_uri: OTHER_POST,
        context_profile_id: profileId(OTHER_DID),
        external_json: null,
      },
    ];
    snapshot.selections = [
      { category: "posts", subject_id: OWN_POST, selected_at: OBSERVED },
    ];

    const { posts } = translate(snapshot);

    expect(posts[0]).toMatchObject({
      isReply: 1,
      replyParentUri: OTHER_POST,
      replyRootUri: OTHER_POST,
      isQuote: 1,
      quotedPostUri: OTHER_POST,
      embedType: "app.bsky.embed.record#view",
    });
    expect(JSON.parse(posts[0].embedJSON as string)).toMatchObject({
      $type: "app.bsky.embed.record#view",
    });
  });

  it("restores an external embed and its preserved preview thumbnail", () => {
    const snapshot = emptySnapshot();
    snapshot.records = [postRecord(OWN_POST)];
    snapshot.recordContext = [
      {
        record_uri: OWN_POST,
        kind: "external",
        context_record_uri: null,
        context_profile_id: null,
        external_json: JSON.stringify({
          uri: "https://example.com/story",
          title: "A story",
          description: "About something",
          thumbUrl: "https://example.com/thumb.jpg",
        }),
      },
    ];
    snapshot.assets = [
      {
        id: "preview:asset",
        kind: "preview",
        media_type: "image/jpeg",
        byte_count: 12,
        sha256: "a".repeat(64),
        archive_path: `media/sha256/aa/${"a".repeat(64)}`,
        availability: "available",
        unavailable_reason: null,
        source_url: "https://example.com/thumb.jpg",
        width: null,
        height: null,
        alt_text: null,
      },
    ];
    snapshot.recordAssets = [
      {
        owner_type: "record",
        owner_id: OWN_POST,
        asset_id: "preview:asset",
        role: "preview",
        position: 0,
      },
    ];

    const { postExternals } = translate(snapshot, [
      {
        assetId: "preview:asset",
        availability: "restored",
        localPath: "file:///accounts/media/sha256-aaa",
      },
    ]);

    expect(postExternals).toEqual([
      expect.objectContaining({
        postUri: OWN_POST,
        uri: "https://example.com/story",
        title: "A story",
        thumbUrl: "https://example.com/thumb.jpg",
        thumbLocalPath: "file:///accounts/media/sha256-aaa",
      }),
    ]);
  });

  it("points restored media at the local file and records that it is complete", () => {
    const snapshot = emptySnapshot();
    snapshot.records = [postRecord(OWN_POST)];
    snapshot.assets = [
      {
        id: "bafyimage",
        kind: "image",
        media_type: "image/jpeg",
        byte_count: 210524,
        sha256: "b".repeat(64),
        archive_path: `media/sha256/bb/${"b".repeat(64)}`,
        availability: "available",
        unavailable_reason: null,
        source_url: "https://cdn.example/image",
        width: 800,
        height: 600,
        alt_text: "A landscape",
      },
    ];
    snapshot.recordAssets = [
      {
        owner_type: "record",
        owner_id: OWN_POST,
        asset_id: "bafyimage",
        role: "content",
        position: 0,
      },
    ];

    const { mediaAssets, postMedia } = translate(snapshot, [
      {
        assetId: "bafyimage",
        availability: "restored",
        localPath: "file:///accounts/media/sha256-bbb",
      },
    ]);

    expect(mediaAssets).toEqual([
      expect.objectContaining({
        contentCid: "bafyimage",
        mediaType: "image",
        mimeType: "image/jpeg",
        localPath: "file:///accounts/media/sha256-bbb",
        downloadState: "complete",
        lastError: null,
        sourceUrl: "https://cdn.example/image",
      }),
    ]);
    expect(postMedia).toEqual([
      expect.objectContaining({
        postUri: OWN_POST,
        position: 0,
        mediaType: "image",
        blobCid: "bafyimage",
        assetCid: "bafyimage",
        alt: "A landscape",
        width: 800,
        height: 600,
        fullsizeUrl: "https://cdn.example/image",
      }),
    ]);
  });

  it("keeps a missing asset explicit, retryable, and still attached to its record", () => {
    const snapshot = emptySnapshot();
    snapshot.archive.completeness = "incomplete";
    snapshot.records = [postRecord(OWN_POST)];
    snapshot.assets = [
      {
        id: "bafygone",
        kind: "video",
        media_type: "video/mp4",
        byte_count: null,
        sha256: null,
        archive_path: null,
        availability: "missing",
        unavailable_reason: "Cyd has not finished preserving this file.",
        source_url: "https://cdn.example/video",
        width: null,
        height: null,
        alt_text: null,
      },
    ];
    snapshot.recordAssets = [
      {
        owner_type: "record",
        owner_id: OWN_POST,
        asset_id: "bafygone",
        role: "content",
        position: 0,
      },
    ];

    const { mediaAssets, postMedia, completeness } = translate(snapshot);

    expect(completeness).toBe("incomplete");
    expect(mediaAssets[0]).toMatchObject({
      contentCid: "bafygone",
      localPath: null,
      downloadState: "failed",
      lastError: "Cyd has not finished preserving this file.",
      sourceUrl: "https://cdn.example/video",
    });
    expect(postMedia[0]).toMatchObject({
      postUri: OWN_POST,
      assetCid: "bafygone",
      playlistUrl: "https://cdn.example/video",
    });
  });

  it("restores chats, their members, and a preview of the latest message", () => {
    const snapshot = emptySnapshot();
    snapshot.profiles.push({
      id: profileId(OTHER_DID),
      did: OTHER_DID,
      handle: "other.bsky.social",
      display_name: "Other",
      avatar_asset_id: null,
      banner_asset_id: null,
      captured_at: OBSERVED,
    });
    snapshot.conversations = [
      {
        id: "convo-1",
        rev: "rev-1",
        first_observed_at: OBSERVED,
        observed_at: "2026-09-11T17:00:00.000Z",
        source_deleted_at: null,
      },
    ];
    snapshot.conversationMembers = [
      { conversation_id: "convo-1", profile_id: profileId(ACCOUNT_DID) },
      { conversation_id: "convo-1", profile_id: profileId(OTHER_DID) },
    ];
    snapshot.messages = [
      {
        id: "msg-1",
        conversation_id: "convo-1",
        sender_profile_id: profileId(ACCOUNT_DID),
        sent_at: "2026-09-10T22:25:59.166Z",
        observed_at: OBSERVED,
        source_deleted_at: null,
        text: "First",
        facets_json: null,
        payload_json: JSON.stringify({ record: { text: "First" } }),
      },
      {
        id: "msg-2",
        conversation_id: "convo-1",
        sender_profile_id: profileId(OTHER_DID),
        sent_at: "2026-09-10T22:26:59.166Z",
        observed_at: OBSERVED,
        source_deleted_at: "2026-09-12T09:00:00.000Z",
        text: "Second",
        facets_json: null,
        payload_json: JSON.stringify({
          record: { text: "Second" },
          embed: { $type: "app.bsky.embed.record#view" },
        }),
      },
    ];
    snapshot.selections = [
      { category: "chats", subject_id: "convo-1", selected_at: OBSERVED },
    ];

    const { conversations, messages } = translate(snapshot);

    expect(conversations).toEqual([
      expect.objectContaining({
        convoId: "convo-1",
        rev: "rev-1",
        memberDids: JSON.stringify([ACCOUNT_DID, OTHER_DID]),
        lastMessageId: "msg-2",
        lastMessageText: "Second",
        lastMessageSenderDid: OTHER_DID,
        lastMessageSentAt: "2026-09-10T22:26:59.166Z",
        leftAt: null,
      }),
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      messageId: "msg-2",
      convoId: "convo-1",
      senderDid: OTHER_DID,
      text: "Second",
      deletedAt: Date.parse("2026-09-12T09:00:00.000Z"),
    });
    expect(JSON.parse(messages[1].embedJSON as string)).toMatchObject({
      $type: "app.bsky.embed.record#view",
    });
  });

  it("restores captured authors, including one known only by its DID", () => {
    const snapshot = emptySnapshot();
    snapshot.profiles.push({
      id: profileId(OTHER_DID),
      did: OTHER_DID,
      handle: null,
      display_name: null,
      avatar_asset_id: null,
      banner_asset_id: null,
      captured_at: OBSERVED,
    });

    const { profiles } = translate(snapshot);

    expect(profiles).toEqual([
      expect.objectContaining({
        did: ACCOUNT_DID,
        handle: "owner.bsky.social",
        displayName: "Owner",
      }),
      expect.objectContaining({
        did: OTHER_DID,
        handle: OTHER_DID,
        displayName: null,
      }),
    ]);
  });

  it("gives a profile its restored avatar so it renders offline", () => {
    const snapshot = emptySnapshot();
    snapshot.profiles[0].avatar_asset_id = "avatar-asset";
    snapshot.assets = [
      {
        id: "avatar-asset",
        kind: "image",
        media_type: "image/jpeg",
        byte_count: 100,
        sha256: "c".repeat(64),
        archive_path: `media/sha256/cc/${"c".repeat(64)}`,
        availability: "available",
        unavailable_reason: null,
        source_url: "https://cdn.example/avatar",
        width: null,
        height: null,
        alt_text: null,
      },
    ];

    const { profiles } = translate(snapshot, [
      {
        assetId: "avatar-asset",
        availability: "restored",
        localPath: "file:///accounts/media/sha256-ccc",
      },
    ]);

    expect(profiles[0].avatarUrl).toBe("file:///accounts/media/sha256-ccc");
  });

  it("falls back to a profile's avatar URL when the archive carries no local copy", () => {
    const snapshot = emptySnapshot();
    snapshot.profiles[0].avatar_asset_id = "avatar-asset";
    snapshot.assets = [
      {
        id: "avatar-asset",
        kind: "image",
        media_type: "image/jpeg",
        byte_count: null,
        sha256: null,
        archive_path: null,
        availability: "missing",
        unavailable_reason: "Never preserved.",
        source_url: "https://cdn.example/avatar",
        width: null,
        height: null,
        alt_text: null,
      },
    ];

    const { profiles } = translate(snapshot);

    expect(profiles[0].avatarUrl).toBe("https://cdn.example/avatar");
  });

  it("restores follows, and reports the relationships Mobile has nowhere to keep", () => {
    const snapshot = emptySnapshot();
    snapshot.relationships = [
      {
        uri: "at://did:plc:owner/app.bsky.graph.follow/fff",
        kind: "follow",
        actor_did: ACCOUNT_DID,
        subject_did: OTHER_DID,
        created_at: "2026-09-01T00:00:00.000Z",
        observed_at: OBSERVED,
        source_deleted_at: null,
      },
      {
        uri: "at://did:plc:owner/app.bsky.graph.block/bbb",
        kind: "block",
        actor_did: ACCOUNT_DID,
        subject_did: OTHER_DID,
        created_at: null,
        observed_at: OBSERVED,
        source_deleted_at: null,
      },
    ];

    const { follows, unrestorable } = translate(snapshot);

    expect(follows).toEqual([
      expect.objectContaining({
        uri: "at://did:plc:owner/app.bsky.graph.follow/fff",
        subjectDid: OTHER_DID,
        createdAt: "2026-09-01T00:00:00.000Z",
        unfollowedAt: null,
      }),
    ]);
    expect(unrestorable).toMatchObject({ relationships: 1 });
  });

  it("names the identity the restored local account belongs to", () => {
    const snapshot = emptySnapshot();

    const { identity } = translate(snapshot);

    expect(identity).toMatchObject({
      did: ACCOUNT_DID,
      handle: "owner.bsky.social",
      displayName: "Owner",
    });
  });
});

import type { MobilePostWrite } from "@/services/archive-restore";

import { planBlueskyArchiveMerge } from "../merge-plan";
import type { ExistingAccountRows, ExistingPostRow } from "../rows";

/**
 * The recovery union, as a decision about rows.
 *
 * Everything the merge promises somebody — that importing twice changes
 * nothing, that a Cyd Bluesky archive never blanks out what this device knows,
 * that data the archive says nothing about survives — is decided here, with no
 * database in sight. A row the plan does not carry is a row nothing writes.
 */

const ARCHIVE_DID = "did:plc:archive";

function post(overrides: Partial<MobilePostWrite> = {}): MobilePostWrite {
  return {
    uri: "at://did:plc:archive/app.bsky.feed.post/one",
    cid: "cid-one",
    authorDid: ARCHIVE_DID,
    text: "hello",
    facetsJSON: null,
    embedType: null,
    embedJSON: null,
    langs: null,
    isReply: 0,
    replyParentUri: null,
    replyRootUri: null,
    isQuote: 0,
    quotedPostUri: null,
    isRepost: 0,
    repostUri: null,
    repostCid: null,
    originalPostUri: null,
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
    quoteCount: 0,
    viewerLiked: 0,
    likeUri: null,
    viewerReposted: 0,
    viewerBookmarked: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    savedAt: 1_000,
    deletedPostAt: null,
    deletedRepostAt: null,
    deletedLikeAt: null,
    deletedBookmarkAt: null,
    ...overrides,
  };
}

/** An archive's row, as it arrives at the plan: no local-only columns set. */
function archived(row: MobilePostWrite): ExistingPostRow {
  return { ...row, preserve: 0 };
}

function existing(
  overrides: Partial<ExistingAccountRows> = {},
): ExistingAccountRows {
  return {
    profiles: [],
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

function incoming(
  overrides: Partial<ExistingAccountRows> = {},
): ExistingAccountRows {
  return {
    profiles: [],
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

describe("planning a Cyd Bluesky archive merge", () => {
  it("adds a record the account no longer holds, and previews it as a restoration", () => {
    const plan = planBlueskyArchiveMerge(
      existing(),
      incoming({ posts: [archived(post({ text: "a post deleted from Cyd" }))] }),
    );

    expect(plan.posts).toHaveLength(1);
    expect(plan.posts[0]).toMatchObject({
      uri: "at://did:plc:archive/app.bsky.feed.post/one",
      text: "a post deleted from Cyd",
      preserve: 0,
    });
    expect(plan.summary.posts).toEqual({ added: 1, updated: 0, unchanged: 0 });
    expect(plan.summary.restorations.total).toBe(1);
    expect(plan.summary.restorations.records).toEqual([
      {
        category: "posts",
        id: "at://did:plc:archive/app.bsky.feed.post/one",
        text: "a post deleted from Cyd",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("writes nothing when the archive holds what the account already holds", () => {
    const plan = planBlueskyArchiveMerge(
      existing({ posts: [{ ...post(), preserve: 0 }] }),
      incoming({ posts: [archived(post())] }),
    );

    expect(plan.posts).toEqual([]);
    expect(plan.summary.posts).toEqual({ added: 0, updated: 0, unchanged: 1 });
    expect(plan.summary.restorations.total).toBe(0);
  });
  it("does not let a quieter archive blank out what the account knows", () => {
    const plan = planBlueskyArchiveMerge(
      existing({
        posts: [
          {
            ...post({ text: "the full text", langs: "en", savedAt: 5_000 }),
            preserve: 0,
          },
        ],
      }),
      incoming({ posts: [archived(post({ text: "", langs: null, savedAt: 9_000 }))] }),
    );

    expect(plan.posts).toEqual([]);
    expect(plan.summary.posts.unchanged).toBe(1);
  });

  it("takes the newer observation when both sides hold a value", () => {
    const plan = planBlueskyArchiveMerge(
      existing({
        posts: [
          {
            ...post({ text: "before an edit", likeCount: 1, savedAt: 5_000 }),
            preserve: 0,
          },
        ],
      }),
      incoming({
        posts: [
          archived(post({ text: "after an edit", likeCount: 4, savedAt: 9_000 })),
        ],
      }),
    );

    expect(plan.posts[0]).toMatchObject({
      text: "after an edit",
      likeCount: 4,
      // The union of when Cyd held it is when it first did.
      savedAt: 5_000,
    });
    expect(plan.summary.posts).toEqual({ added: 0, updated: 1, unchanged: 0 });
  });

  it("keeps a like the archive was taken before, and takes one it was taken after", () => {
    const plan = planBlueskyArchiveMerge(
      existing({
        posts: [
          { ...post({ viewerLiked: 1, savedAt: 9_000 }), preserve: 0 },
          {
            ...post({
              uri: "at://did:plc:archive/app.bsky.feed.post/two",
              viewerLiked: 0,
              savedAt: 9_000,
            }),
            preserve: 0,
          },
        ],
      }),
      incoming({
        posts: [
          archived(post({ viewerLiked: 0, savedAt: 1_000 })),
          archived(
            post({
              uri: "at://did:plc:archive/app.bsky.feed.post/two",
              viewerLiked: 1,
              savedAt: 1_000,
            }),
          ),
        ],
      }),
    );

    expect(plan.posts.map((row) => [row.uri, row.viewerLiked])).toEqual([
      ["at://did:plc:archive/app.bsky.feed.post/one", 1],
      ["at://did:plc:archive/app.bsky.feed.post/two", 1],
    ]);
  });

  it("keeps a source deletion either side observed, at the earlier time", () => {
    const plan = planBlueskyArchiveMerge(
      existing({
        posts: [{ ...post({ deletedPostAt: null }), preserve: 0 }],
      }),
      incoming({ posts: [archived(post({ deletedPostAt: 4_000 }))] }),
    );

    expect(plan.posts[0]).toMatchObject({ deletedPostAt: 4_000 });
  });

  it("never clears a post the person chose to preserve", () => {
    const plan = planBlueskyArchiveMerge(
      existing({
        posts: [{ ...post({ text: "kept", savedAt: 1_000 }), preserve: 1 }],
      }),
      incoming({ posts: [archived(post({ text: "kept again", savedAt: 9_000 }))] }),
    );

    expect(plan.posts[0]).toMatchObject({ text: "kept again", preserve: 1 });
  });

  it("leaves data the archive says nothing about out of the plan entirely", () => {
    const untouched = {
      ...post({ uri: "at://did:plc:archive/app.bsky.feed.post/local" }),
      preserve: 0,
    };

    const plan = planBlueskyArchiveMerge(
      existing({ posts: [untouched] }),
      incoming({ posts: [] }),
    );

    expect(plan.posts).toEqual([]);
    expect(plan.summary.posts).toEqual({ added: 0, updated: 0, unchanged: 0 });
    expect(plan.summary.restorations.total).toBe(0);
  });

  it("upgrades a failed download when the archive brought the file", () => {
    const plan = planBlueskyArchiveMerge(
      existing({
        mediaAssets: [
          {
            contentCid: "bafy-one",
            mediaType: "image",
            mimeType: "image/jpeg",
            byteLength: null,
            localPath: null,
            sourceUrl: "https://cdn.bsky.app/one.jpg",
            sourceDid: ARCHIVE_DID,
            sourceMetadataJSON: null,
            downloadState: "failed",
            lastError: "Network request failed",
            attemptCount: 3,
            downloadedAt: null,
          },
        ],
      }),
      incoming({
        mediaAssets: [
          {
            contentCid: "bafy-one",
            mediaType: "image",
            mimeType: "image/jpeg",
            byteLength: 1_024,
            localPath: "file:///accounts/media/sha256-abc",
            sourceUrl: "https://cdn.bsky.app/one.jpg",
            sourceDid: ARCHIVE_DID,
            sourceMetadataJSON: null,
            downloadState: "complete",
            lastError: null,
            attemptCount: 0,
            downloadedAt: 7_000,
          },
        ],
      }),
    );

    expect(plan.mediaAssets[0]).toMatchObject({
      downloadState: "complete",
      localPath: "file:///accounts/media/sha256-abc",
      lastError: null,
      // What this device has already been through with the file is its own.
      attemptCount: 3,
    });
  });

  it("does not trade a file this device holds for one it cannot open", () => {
    const stored = {
      contentCid: "bafy-one",
      mediaType: "image" as const,
      mimeType: "image/jpeg",
      byteLength: 1_024,
      localPath: "file:///accounts/media/sha256-abc",
      sourceUrl: "https://cdn.bsky.app/one.jpg",
      sourceDid: ARCHIVE_DID,
      sourceMetadataJSON: null,
      downloadState: "complete" as const,
      lastError: null,
      attemptCount: 0,
      downloadedAt: 7_000,
    };

    const plan = planBlueskyArchiveMerge(
      existing({ mediaAssets: [stored] }),
      incoming({
        mediaAssets: [
          {
            ...stored,
            localPath: null,
            byteLength: null,
            downloadState: "failed",
            lastError: "This file was not included in the archive.",
            attemptCount: 0,
            downloadedAt: null,
          },
        ],
      }),
    );

    expect(plan.mediaAssets).toEqual([]);
  });
});

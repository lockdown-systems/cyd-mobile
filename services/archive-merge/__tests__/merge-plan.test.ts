import type { MobilePostWrite } from "@/services/archive-restore";

import { planBlueskyArchiveMerge, totalMergeChanges } from "../merge-plan";
import type { BlueskyArchiveMergeSummary } from "../merge-plan";
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
  it("adds a record the account no longer holds, and counts it", () => {
    const plan = planBlueskyArchiveMerge(
      existing(),
      incoming({ posts: [archived(post({ text: "a post deleted from Cyd" }))] }),
    ARCHIVE_DID,
    );

    expect(plan.posts).toHaveLength(1);
    expect(plan.posts[0]).toMatchObject({
      uri: "at://did:plc:archive/app.bsky.feed.post/one",
      text: "a post deleted from Cyd",
      preserve: 0,
    });
    expect(plan.summary.posts).toEqual({ added: 1, updated: 0, unchanged: 0 });
    expect(plan.summary.addedRecords.posts).toBe(1);
  });

  it("writes nothing when the archive holds what the account already holds", () => {
    const plan = planBlueskyArchiveMerge(
      existing({ posts: [{ ...post(), preserve: 0 }] }),
      incoming({ posts: [archived(post())] }),
    ARCHIVE_DID,
    );

    expect(plan.posts).toEqual([]);
    expect(plan.summary.posts).toEqual({ added: 0, updated: 0, unchanged: 1 });
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
    ARCHIVE_DID,
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
    ARCHIVE_DID,
    );

    expect(plan.posts[0]).toMatchObject({
      text: "after an edit",
      likeCount: 4,
      // The union of when Cyd held it is when it first did.
      savedAt: 5_000,
    });
    expect(plan.summary.posts).toEqual({ added: 0, updated: 1, unchanged: 0 });
  });

  it("does not let an archive that counted nothing zero out a count", () => {
    const plan = planBlueskyArchiveMerge(
      existing({
        posts: [
          {
            ...post({ likeCount: 5, replyCount: 2, savedAt: 5_000 }),
            preserve: 0,
          },
        ],
      }),
      incoming({
        posts: [
          archived(
            post({ likeCount: 0, replyCount: 3, savedAt: 9_000 }),
          ),
        ],
      }),
    ARCHIVE_DID,
    );

    expect(plan.posts[0]).toMatchObject({ likeCount: 5, replyCount: 3 });
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
    ARCHIVE_DID,
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
    ARCHIVE_DID,
    );

    expect(plan.posts[0]).toMatchObject({ deletedPostAt: 4_000 });
  });

  it("never clears a post the person chose to preserve", () => {
    const plan = planBlueskyArchiveMerge(
      existing({
        posts: [{ ...post({ text: "kept", savedAt: 1_000 }), preserve: 1 }],
      }),
      incoming({ posts: [archived(post({ text: "kept again", savedAt: 9_000 }))] }),
    ARCHIVE_DID,
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
    ARCHIVE_DID,
    );

    expect(plan.posts).toEqual([]);
    expect(plan.summary.posts).toEqual({ added: 0, updated: 0, unchanged: 0 });
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
    ARCHIVE_DID,
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
    ARCHIVE_DID,
    );

    expect(plan.mediaAssets).toEqual([]);
  });
});

/**
 * Counting the added rows the way the Browse tabs count them, so a preview can
 * say "2 likes" to somebody who will go and look at the Likes tab.
 */
describe("naming what a merge would add", () => {
  const added = (rows: MobilePostWrite[]) =>
    planBlueskyArchiveMerge(
      existing(),
      incoming({ posts: rows.map(archived) }),
      ARCHIVE_DID,
    ).summary.addedRecords;

  it("counts the account's own posts as posts", () => {
    expect(added([post()])).toMatchObject({ posts: 1, likes: 0, reposts: 0 });
  });

  it("counts somebody else's post the account liked as a like, not a post", () => {
    const liked = post({
      uri: "at://did:plc:someone/app.bsky.feed.post/two",
      authorDid: "did:plc:someone",
      viewerLiked: 1,
    });

    expect(added([liked])).toMatchObject({ posts: 0, likes: 1 });
  });

  it("counts a repost as a repost", () => {
    const reposted = post({
      uri: "at://did:plc:someone/app.bsky.feed.post/three",
      authorDid: "did:plc:someone",
      isRepost: 1,
      viewerReposted: 1,
    });

    expect(added([reposted])).toMatchObject({ posts: 0, reposts: 1 });
  });

  it("counts the account's own post that it also liked under both, as Browse does", () => {
    // Browse shows this row in the Posts tab and in the Likes tab, so a
    // preview that claimed one or the other would disagree with what somebody
    // finds when they go and look.
    expect(added([post({ viewerLiked: 1 })])).toMatchObject({
      posts: 1,
      likes: 1,
    });
  });

  it("says nothing about a kind with nothing to add", () => {
    expect(added([])).toEqual({
      posts: 0,
      reposts: 0,
      likes: 0,
      bookmarks: 0,
      follows: 0,
      chats: 0,
      messages: 0,
    });
  });
});

/**
 * Whether a merge would change anything, asked of the summary rather than of
 * whichever tables somebody remembered to look at.
 */
describe("adding a merge summary up", () => {
  const none = { added: 0, updated: 0, unchanged: 0 };
  const summary = (
    overrides: Partial<BlueskyArchiveMergeSummary> = {},
  ): BlueskyArchiveMergeSummary => ({
    profiles: none,
    posts: none,
    postMedia: none,
    postExternals: none,
    bookmarks: none,
    follows: none,
    conversations: none,
    messages: none,
    mediaAssets: none,
    addedRecords: {
      posts: 0,
      reposts: 0,
      likes: 0,
      bookmarks: 0,
      follows: 0,
      chats: 0,
      messages: 0,
    },
    ...overrides,
  });

  it("is nothing only when every table is", () => {
    expect(totalMergeChanges(summary()).total).toBe(0);
  });

  it("counts a recovered file, which no record table mentions", () => {
    const totals = totalMergeChanges(
      summary({ mediaAssets: { added: 0, updated: 1, unchanged: 4 } }),
    );

    expect(totals.files).toEqual({ added: 0, updated: 1 });
    expect(totals.records).toEqual({ added: 0, updated: 0 });
    expect(totals.total).toBe(1);
  });

  it("counts the rows a record needs to render, under their own heading", () => {
    const totals = totalMergeChanges(
      summary({
        profiles: { added: 1, updated: 0, unchanged: 2 },
        postExternals: { added: 0, updated: 1, unchanged: 0 },
      }),
    );

    expect(totals.context).toEqual({ added: 1, updated: 1 });
    expect(totals.total).toBe(2);
  });

  it("groups every kind of record together", () => {
    const totals = totalMergeChanges(
      summary({
        posts: { added: 2, updated: 1, unchanged: 0 },
        messages: { added: 3, updated: 0, unchanged: 0 },
        conversations: { added: 1, updated: 0, unchanged: 0 },
        bookmarks: { added: 1, updated: 0, unchanged: 0 },
        follows: { added: 1, updated: 0, unchanged: 0 },
      }),
    );

    expect(totals.records).toEqual({ added: 8, updated: 1 });
    expect(totals.total).toBe(9);
  });
});

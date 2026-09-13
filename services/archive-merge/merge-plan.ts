import {
  earliest,
  latest,
  preferCounted,
  preferPopulated,
  unionFlag,
} from "./union";
import type {
  ExistingAccountRows,
  ExistingMediaAssetRow,
  ExistingPostRow,
  MobileBookmarkWrite,
  MobileConversationWrite,
  MobileFollowWrite,
  MobileMessageWrite,
  MobilePostExternalWrite,
  MobilePostMediaWrite,
  MobileProfileWrite,
} from "./rows";

/**
 * The recovery union, decided before anything is written.
 *
 * A Bluesky archive import into an account this installation already holds is
 * a union, not a replacement: every record either side knows about survives,
 * records that share a stable Bluesky identifier collapse into one, and an
 * archive that is quieter than the account — an older export, a partial one —
 * never turns what the account knows back into absence.
 *
 * The plan is the whole decision. It carries the rows that would change and
 * the counts somebody is shown before agreeing to it, so committing is just
 * writing what was previewed (AC: "previewed explicitly before commit").
 */

export type BlueskyArchiveMergeCounts = {
  /** Rows the account does not hold, which the archive brings back. */
  added: number;
  /** Rows both sides hold, which the archive has something to add to. */
  updated: number;
  unchanged: number;
};

/**
 * How many of each kind of record a merge would add, named the way Browse
 * names them.
 *
 * Mobile keeps posts, reposts, likes and bookmarks in one table and tells them
 * apart by column, so this classifies the rows the same way the Browse tabs
 * count them. A row can land under two headings — the account's own post that
 * it also liked is both — which is exactly what Browse shows, so agreeing with
 * it beats adding up to a tidier total.
 */
export type AddedRecordCounts = {
  posts: number;
  reposts: number;
  likes: number;
  bookmarks: number;
  follows: number;
  chats: number;
  messages: number;
};

export type BlueskyArchiveMergeSummary = {
  profiles: BlueskyArchiveMergeCounts;
  posts: BlueskyArchiveMergeCounts;
  postMedia: BlueskyArchiveMergeCounts;
  postExternals: BlueskyArchiveMergeCounts;
  bookmarks: BlueskyArchiveMergeCounts;
  follows: BlueskyArchiveMergeCounts;
  conversations: BlueskyArchiveMergeCounts;
  messages: BlueskyArchiveMergeCounts;
  mediaAssets: BlueskyArchiveMergeCounts;
  /** The added rows, by the name somebody would give them. */
  addedRecords: AddedRecordCounts;
};

/**
 * What each table in a summary amounts to, for somebody deciding about it.
 *
 * A merge summary has one entry per table, and the tables are not equally
 * interesting: somebody recognises a post, has no idea what a `post_external`
 * is, and thinks of a recovered image as a file rather than a row. Grouping
 * them is what lets a preview say something true in one sentence.
 *
 * The map is exhaustive on purpose. Reading a nine-table summary by hand is
 * how a merge that recovers a missing image comes to announce itself as
 * changing nothing: whoever adds the tenth table has to say what it is here,
 * or this does not compile.
 */
const MERGE_CATEGORIES: Record<
  Exclude<keyof BlueskyArchiveMergeSummary, "addedRecords">,
  "records" | "files" | "context"
> = {
  posts: "records",
  bookmarks: "records",
  follows: "records",
  conversations: "records",
  messages: "records",
  mediaAssets: "files",
  profiles: "context",
  postMedia: "context",
  postExternals: "context",
};

export type BlueskyArchiveMergeTotals = {
  /** Records somebody would recognise as theirs. */
  records: { added: number; updated: number };
  /** Media files: one this account never had, or one it failed to download. */
  files: { added: number; updated: number };
  /** What a record needs to render: authors, attachments, link previews. */
  context: { added: number; updated: number };
  /** Every write the plan would make. Zero is the only honest "nothing". */
  total: number;
};

/**
 * Add a summary up, so that "would this change anything?" has one answer.
 *
 * Both the preview somebody agrees to and the report afterwards ask it, and a
 * merge is only a no-op when every table is: an archive whose single
 * difference is the image an earlier export could not carry changes something
 * worth being told about.
 */
export function totalMergeChanges(
  summary: BlueskyArchiveMergeSummary,
): BlueskyArchiveMergeTotals {
  const totals: BlueskyArchiveMergeTotals = {
    records: { added: 0, updated: 0 },
    files: { added: 0, updated: 0 },
    context: { added: 0, updated: 0 },
    total: 0,
  };

  for (const [table, group] of Object.entries(MERGE_CATEGORIES) as [
    keyof typeof MERGE_CATEGORIES,
    "records" | "files" | "context",
  ][]) {
    const counts = summary[table];
    totals[group].added += counts.added;
    totals[group].updated += counts.updated;
    totals.total += counts.added + counts.updated;
  }

  return totals;
}

export type BlueskyArchiveMergePlan = {
  profiles: MobileProfileWrite[];
  posts: ExistingPostRow[];
  postMedia: MobilePostMediaWrite[];
  postExternals: MobilePostExternalWrite[];
  bookmarks: MobileBookmarkWrite[];
  follows: MobileFollowWrite[];
  conversations: MobileConversationWrite[];
  messages: MobileMessageWrite[];
  mediaAssets: ExistingMediaAssetRow[];
  summary: BlueskyArchiveMergeSummary;
};

type TableRules<Row> = {
  /** The stable Bluesky identifier two copies of a record share. */
  key: (row: Row) => string;
  union: (local: Row, incoming: Row) => Row;
};

type TableResult<Row> = {
  writes: Row[];
  counts: BlueskyArchiveMergeCounts;
  added: Row[];
};

/**
 * Merge one table, writing only what would actually change.
 *
 * The comparison against the stored row is what makes a repeated import free:
 * a union that comes back equal to what is already there produces no write at
 * all, so importing the same Cyd Bluesky archive twice is indistinguishable
 * from importing it once.
 */
function mergeTable<Row extends object>(
  local: Row[],
  incoming: Row[],
  rules: TableRules<Row>,
): TableResult<Row> {
  const stored = new Map(local.map((row) => [rules.key(row), row]));
  const writes: Row[] = [];
  const added: Row[] = [];
  let updated = 0;
  let unchanged = 0;

  for (const row of incoming) {
    const existing = stored.get(rules.key(row));
    if (!existing) {
      writes.push(row);
      added.push(row);
      continue;
    }
    const merged = rules.union(existing, row);
    if (sameRow(existing, merged)) {
      unchanged += 1;
      continue;
    }
    writes.push(merged);
    updated += 1;
  }

  return {
    writes,
    added,
    counts: { added: added.length, updated, unchanged },
  };
}

function sameRow(left: object, right: object): boolean {
  const keys = Object.keys(left);
  return keys.every(
    (key) =>
      (left as Record<string, unknown>)[key] ===
      (right as Record<string, unknown>)[key],
  );
}

/**
 * Union an account's Bluesky saved data with an archive's.
 *
 * Both sides are the same shape on purpose: what the account holds and what
 * the archive carries are compared as the same rows by the same rules, so
 * "the same record" cannot come to mean two things.
 */
export function planBlueskyArchiveMerge(
  existing: ExistingAccountRows,
  incoming: ExistingAccountRows,
  /** Whose account this is, which is what makes a post theirs rather than
   * somebody else's that they liked. */
  accountDid: string,
): BlueskyArchiveMergePlan {
  const profiles = mergeTable(existing.profiles, incoming.profiles, {
    key: (row) => row.did,
    union: unionProfile,
  });
  const posts = mergeTable(existing.posts, incoming.posts, {
    key: (row) => row.uri,
    union: unionPost,
  });
  const postMedia = mergeTable(existing.postMedia, incoming.postMedia, {
    key: (row) => `${row.postUri}#${row.position}`,
    union: unionPostMedia,
  });
  const postExternals = mergeTable(
    existing.postExternals,
    incoming.postExternals,
    { key: (row) => row.postUri, union: unionPostExternal },
  );
  const bookmarks = mergeTable(existing.bookmarks, incoming.bookmarks, {
    key: (row) => row.subjectUri,
    union: unionBookmark,
  });
  const follows = mergeTable(existing.follows, incoming.follows, {
    key: (row) => row.uri,
    union: unionFollow,
  });
  const conversations = mergeTable(
    existing.conversations,
    incoming.conversations,
    { key: (row) => row.convoId, union: unionConversation },
  );
  const messages = mergeTable(existing.messages, incoming.messages, {
    key: (row) => row.messageId,
    union: unionMessage,
  });
  const mediaAssets = mergeTable(existing.mediaAssets, incoming.mediaAssets, {
    key: (row) => row.contentCid,
    union: unionMediaAsset,
  });

  return {
    profiles: profiles.writes,
    posts: posts.writes,
    postMedia: postMedia.writes,
    postExternals: postExternals.writes,
    bookmarks: bookmarks.writes,
    follows: follows.writes,
    conversations: conversations.writes,
    messages: messages.writes,
    mediaAssets: mediaAssets.writes,
    summary: {
      profiles: profiles.counts,
      posts: posts.counts,
      postMedia: postMedia.counts,
      postExternals: postExternals.counts,
      bookmarks: bookmarks.counts,
      follows: follows.counts,
      conversations: conversations.counts,
      messages: messages.counts,
      mediaAssets: mediaAssets.counts,
      addedRecords: countAddedRecords(accountDid, {
        posts: posts.added,
        bookmarks: bookmarks.added,
        follows: follows.added,
        conversations: conversations.added,
        messages: messages.added,
      }),
    },
  };
}

/**
 * Count the added rows under the headings Browse uses.
 *
 * The rules are Browse's own (`buildTotalCountQuery`): a post is one this
 * account wrote and did not repost, while a repost, a like and a bookmark are
 * any post row carrying that mark. Saying "3 posts and 2 likes" rather than
 * "5 records" is only true if it is counted the way the tabs somebody will go
 * and look at are counted.
 */
function countAddedRecords(
  accountDid: string,
  added: {
    posts: ExistingPostRow[];
    bookmarks: MobileBookmarkWrite[];
    follows: MobileFollowWrite[];
    conversations: MobileConversationWrite[];
    messages: MobileMessageWrite[];
  },
): AddedRecordCounts {
  const posts = added.posts.filter(
    (row) => row.authorDid === accountDid && row.isRepost === 0,
  ).length;

  return {
    posts,
    reposts: added.posts.filter((row) => row.viewerReposted === 1).length,
    likes: added.posts.filter((row) => row.viewerLiked === 1).length,
    // Bookmarks live in their own table as well as on the post row; the table
    // is the record, so it is what gets counted.
    bookmarks: added.bookmarks.length,
    follows: added.follows.length,
    chats: added.conversations.length,
    messages: added.messages.length,
  };
}


function unionProfile(
  local: MobileProfileWrite,
  incoming: MobileProfileWrite,
): MobileProfileWrite {
  const newer = incoming.updatedAt > local.updatedAt;
  return {
    did: local.did,
    handle: preferPopulated(local.handle, incoming.handle, newer),
    displayName: preferPopulated(local.displayName, incoming.displayName, newer),
    avatarUrl: preferPopulated(local.avatarUrl, incoming.avatarUrl, newer),
    savedAt: earliestObservation(local.savedAt, incoming.savedAt),
    updatedAt: Math.max(local.updatedAt, incoming.updatedAt),
  };
}

/**
 * One post, as both sides know it.
 *
 * Viewer state is a union rather than a choice: a like or a repost recorded on
 * either side is something that happened, and an archive taken before somebody
 * liked a post must not un-like it. Deletion timestamps take the earliest
 * either side observed, because that is when Bluesky stopped holding it.
 */
function unionPost(
  local: ExistingPostRow,
  incoming: ExistingPostRow,
): ExistingPostRow {
  const newer = incoming.savedAt > local.savedAt;
  const metric = (left: number, right: number): number =>
    preferCounted(left, right, newer);

  return {
    uri: local.uri,
    cid: preferPopulated(local.cid, incoming.cid, newer),
    authorDid: preferPopulated(local.authorDid, incoming.authorDid, newer),
    text: preferPopulated(local.text, incoming.text, newer),
    facetsJSON: preferPopulated(local.facetsJSON, incoming.facetsJSON, newer),
    embedType: preferPopulated(local.embedType, incoming.embedType, newer),
    embedJSON: preferPopulated(local.embedJSON, incoming.embedJSON, newer),
    langs: preferPopulated(local.langs, incoming.langs, newer),
    isReply: unionFlag(local.isReply, incoming.isReply),
    replyParentUri: preferPopulated(
      local.replyParentUri,
      incoming.replyParentUri,
      newer,
    ),
    replyRootUri: preferPopulated(
      local.replyRootUri,
      incoming.replyRootUri,
      newer,
    ),
    isQuote: unionFlag(local.isQuote, incoming.isQuote),
    quotedPostUri: preferPopulated(
      local.quotedPostUri,
      incoming.quotedPostUri,
      newer,
    ),
    isRepost: unionFlag(local.isRepost, incoming.isRepost),
    repostUri: preferPopulated(local.repostUri, incoming.repostUri, newer),
    repostCid: preferPopulated(local.repostCid, incoming.repostCid, newer),
    originalPostUri: preferPopulated(
      local.originalPostUri,
      incoming.originalPostUri,
      newer,
    ),
    likeCount: metric(local.likeCount, incoming.likeCount),
    repostCount: metric(local.repostCount, incoming.repostCount),
    replyCount: metric(local.replyCount, incoming.replyCount),
    quoteCount: metric(local.quoteCount, incoming.quoteCount),
    viewerLiked: unionFlag(local.viewerLiked, incoming.viewerLiked),
    likeUri: preferPopulated(local.likeUri, incoming.likeUri, newer),
    viewerReposted: unionFlag(local.viewerReposted, incoming.viewerReposted),
    viewerBookmarked: unionFlag(
      local.viewerBookmarked,
      incoming.viewerBookmarked,
    ),
    createdAt: preferPopulated(local.createdAt, incoming.createdAt, false),
    savedAt: earliestObservation(local.savedAt, incoming.savedAt),
    deletedPostAt: earliest(local.deletedPostAt, incoming.deletedPostAt),
    deletedRepostAt: earliest(local.deletedRepostAt, incoming.deletedRepostAt),
    deletedLikeAt: earliest(local.deletedLikeAt, incoming.deletedLikeAt),
    deletedBookmarkAt: earliest(
      local.deletedBookmarkAt,
      incoming.deletedBookmarkAt,
    ),
    // A person's own "keep this" is a local choice no archive carries, so an
    // import can only ever leave it alone. Two duplicate local accounts can
    // both carry one, and then either saying "keep" is the answer.
    preserve: unionFlag(local.preserve, incoming.preserve),
  };
}

function unionPostMedia(
  local: MobilePostMediaWrite,
  incoming: MobilePostMediaWrite,
): MobilePostMediaWrite {
  const newer = (incoming.downloadedAt ?? 0) > (local.downloadedAt ?? 0);
  return {
    postUri: local.postUri,
    position: local.position,
    mediaType: preferPopulated(local.mediaType, incoming.mediaType, newer),
    blobCid: preferPopulated(local.blobCid, incoming.blobCid, newer),
    mimeType: preferPopulated(local.mimeType, incoming.mimeType, newer),
    alt: preferPopulated(local.alt, incoming.alt, newer),
    width: preferPopulated(local.width, incoming.width, newer),
    height: preferPopulated(local.height, incoming.height, newer),
    thumbUrl: preferPopulated(local.thumbUrl, incoming.thumbUrl, newer),
    fullsizeUrl: preferPopulated(local.fullsizeUrl, incoming.fullsizeUrl, newer),
    playlistUrl: preferPopulated(local.playlistUrl, incoming.playlistUrl, newer),
    downloadedAt: latest(local.downloadedAt, incoming.downloadedAt),
    assetCid: preferPopulated(local.assetCid, incoming.assetCid, newer),
  };
}

function unionPostExternal(
  local: MobilePostExternalWrite,
  incoming: MobilePostExternalWrite,
): MobilePostExternalWrite {
  return {
    postUri: local.postUri,
    uri: preferPopulated(local.uri, incoming.uri, false),
    title: preferPopulated(local.title, incoming.title, false),
    description: preferPopulated(local.description, incoming.description, false),
    thumbUrl: preferPopulated(local.thumbUrl, incoming.thumbUrl, false),
    // A local copy of the thumbnail beats a URL, and beats another local copy
    // only if this account does not already have one that works.
    thumbLocalPath: preferPopulated(
      local.thumbLocalPath,
      incoming.thumbLocalPath,
      false,
    ),
  };
}

function unionBookmark(
  local: MobileBookmarkWrite,
  incoming: MobileBookmarkWrite,
): MobileBookmarkWrite {
  const newer = incoming.savedAt > local.savedAt;
  return {
    subjectUri: local.subjectUri,
    postAuthorDid: preferPopulated(
      local.postAuthorDid,
      incoming.postAuthorDid,
      newer,
    ),
    postAuthorHandle: preferPopulated(
      local.postAuthorHandle,
      incoming.postAuthorHandle,
      newer,
    ),
    postText: preferPopulated(local.postText, incoming.postText, newer),
    postCreatedAt: preferPopulated(
      local.postCreatedAt,
      incoming.postCreatedAt,
      newer,
    ),
    savedAt: earliestObservation(local.savedAt, incoming.savedAt),
    deletedAt: earliest(local.deletedAt, incoming.deletedAt),
  };
}

function unionFollow(
  local: MobileFollowWrite,
  incoming: MobileFollowWrite,
): MobileFollowWrite {
  const newer = incoming.savedAt > local.savedAt;
  return {
    uri: local.uri,
    cid: preferPopulated(local.cid, incoming.cid, newer),
    subjectDid: preferPopulated(local.subjectDid, incoming.subjectDid, newer),
    handle: preferPopulated(local.handle, incoming.handle, newer),
    displayName: preferPopulated(local.displayName, incoming.displayName, newer),
    avatarUrl: preferPopulated(local.avatarUrl, incoming.avatarUrl, newer),
    createdAt: preferPopulated(local.createdAt, incoming.createdAt, false),
    savedAt: earliestObservation(local.savedAt, incoming.savedAt),
    unfollowedAt: earliest(local.unfollowedAt, incoming.unfollowedAt),
  };
}

function unionConversation(
  local: MobileConversationWrite,
  incoming: MobileConversationWrite,
): MobileConversationWrite {
  const newer = incoming.updatedAt > local.updatedAt;
  return {
    convoId: local.convoId,
    rev: preferPopulated(local.rev, incoming.rev, newer),
    memberDids: preferPopulated(local.memberDids, incoming.memberDids, newer),
    muted: unionFlag(local.muted, incoming.muted),
    lastMessageId: preferPopulated(
      local.lastMessageId,
      incoming.lastMessageId,
      newer,
    ),
    lastMessageText: preferPopulated(
      local.lastMessageText,
      incoming.lastMessageText,
      newer,
    ),
    lastMessageSentAt: preferPopulated(
      local.lastMessageSentAt,
      incoming.lastMessageSentAt,
      newer,
    ),
    lastMessageSenderDid: preferPopulated(
      local.lastMessageSenderDid,
      incoming.lastMessageSenderDid,
      newer,
    ),
    savedAt: earliestObservation(local.savedAt, incoming.savedAt),
    updatedAt: Math.max(local.updatedAt, incoming.updatedAt),
    leftAt: earliest(local.leftAt, incoming.leftAt),
  };
}

function unionMessage(
  local: MobileMessageWrite,
  incoming: MobileMessageWrite,
): MobileMessageWrite {
  const newer = incoming.savedAt > local.savedAt;
  return {
    messageId: local.messageId,
    convoId: preferPopulated(local.convoId, incoming.convoId, newer),
    rev: preferPopulated(local.rev, incoming.rev, newer),
    senderDid: preferPopulated(local.senderDid, incoming.senderDid, newer),
    text: preferPopulated(local.text, incoming.text, newer),
    facetsJSON: preferPopulated(local.facetsJSON, incoming.facetsJSON, newer),
    embedJSON: preferPopulated(local.embedJSON, incoming.embedJSON, newer),
    sentAt: preferPopulated(local.sentAt, incoming.sentAt, false),
    savedAt: earliestObservation(local.savedAt, incoming.savedAt),
    deletedAt: earliest(local.deletedAt, incoming.deletedAt),
  };
}

/**
 * One media file, as this account holds it.
 *
 * A file already on this device is the richest thing either side has, so a
 * local copy is never traded for a source URL, and a failed download is
 * upgraded the moment an archive turns up with the bytes.
 */
function unionMediaAsset(
  local: ExistingMediaAssetRow,
  incoming: ExistingMediaAssetRow,
): ExistingMediaAssetRow {
  const incomingComplete = incoming.downloadState === "complete";
  const localComplete = local.downloadState === "complete";
  const takeIncoming = incomingComplete && !localComplete;

  return {
    contentCid: local.contentCid,
    mediaType: preferPopulated(local.mediaType, incoming.mediaType, takeIncoming),
    mimeType: preferPopulated(local.mimeType, incoming.mimeType, takeIncoming),
    byteLength: preferPopulated(
      local.byteLength,
      incoming.byteLength,
      takeIncoming,
    ),
    localPath: preferPopulated(local.localPath, incoming.localPath, takeIncoming),
    sourceUrl: preferPopulated(local.sourceUrl, incoming.sourceUrl, takeIncoming),
    sourceDid: preferPopulated(local.sourceDid, incoming.sourceDid, takeIncoming),
    sourceMetadataJSON: preferPopulated(
      local.sourceMetadataJSON,
      incoming.sourceMetadataJSON,
      takeIncoming,
    ),
    downloadState: takeIncoming ? incoming.downloadState : local.downloadState,
    // The account's own record of why a download failed stays until a file
    // actually arrives to contradict it.
    lastError: takeIncoming ? incoming.lastError : local.lastError,
    attemptCount: local.attemptCount,
    downloadedAt: takeIncoming
      ? incoming.downloadedAt
      : latest(local.downloadedAt, incoming.downloadedAt),
  };
}

/**
 * When Cyd first held this.
 *
 * `savedAt` is the moment something entered Bluesky saved data, so the union
 * of two accounts of it is the earlier one. A zero means the archive did not
 * say, which is not a claim that it was saved at the epoch.
 */
function earliestObservation(local: number, incoming: number): number {
  if (local === 0) {
    return incoming;
  }
  if (incoming === 0) {
    return local;
  }
  return Math.min(local, incoming);
}

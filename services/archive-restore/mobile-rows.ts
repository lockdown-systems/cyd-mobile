import type {
  BlueskyInterchangeSnapshot,
  InterchangeAsset,
  InterchangeProfile,
  InterchangeRecord,
} from "./interchange-reader";

/**
 * Turning the version 2 interchange model back into Mobile's private rows.
 *
 * This is the inverse of `services/archive-export/interchange.ts`, and it is
 * pure in the same way: in go the archive's rows and what the media-copying
 * pass managed to place on this device, out come the rows Mobile's own browse
 * screens read. No database, no filesystem, no clock.
 *
 * Two rules shape most of the decisions, and they are the export's rules read
 * backwards:
 *
 * 1. Nothing is invented. Where the contract holds something Mobile has no
 *    column for — a block, a message's media, a profile description — the data
 *    is reported as unrestorable rather than bent into a column that means
 *    something else. Where Mobile requires a value the archive does not carry,
 *    the fallback is a fact the archive already states, such as the DID behind
 *    a profile with no handle.
 * 2. What was selected stays selected. The interchange model records a like or
 *    a repost as a record of its own; Mobile records it as viewer state on the
 *    post. A restored account has to be browseable, so a selection always ends
 *    up as the flag the browse queries actually filter on.
 */

const POST_TYPE = "app.bsky.feed.post";
const REPOST_TYPE = "app.bsky.feed.repost";
const LIKE_TYPE = "app.bsky.feed.like";

export type RestoredAssetPlacement =
  | {
      assetId: string;
      availability: "restored";
      /** Where the bytes now live inside the Bluesky local account. */
      localPath: string;
    }
  | {
      assetId: string;
      availability: "missing";
      /** Why there is nothing to show, in the archive's own words. */
      reason: string;
    };

export type MobileProfileWrite = {
  did: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  savedAt: number;
  updatedAt: number;
};

export type MobilePostWrite = {
  uri: string;
  cid: string;
  authorDid: string;
  text: string;
  facetsJSON: string | null;
  embedType: string | null;
  embedJSON: string | null;
  langs: string | null;
  isReply: number;
  replyParentUri: string | null;
  replyRootUri: string | null;
  isQuote: number;
  quotedPostUri: string | null;
  isRepost: number;
  repostUri: string | null;
  repostCid: string | null;
  originalPostUri: string | null;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  viewerLiked: number;
  likeUri: string | null;
  viewerReposted: number;
  viewerBookmarked: number;
  createdAt: string;
  savedAt: number;
  deletedPostAt: number | null;
  deletedRepostAt: number | null;
  deletedLikeAt: number | null;
  deletedBookmarkAt: number | null;
};

export type MobilePostMediaWrite = {
  postUri: string;
  position: number;
  mediaType: "image" | "video";
  blobCid: string;
  mimeType: string | null;
  alt: string | null;
  width: number | null;
  height: number | null;
  thumbUrl: string | null;
  fullsizeUrl: string | null;
  playlistUrl: string | null;
  downloadedAt: number | null;
  assetCid: string;
};

export type MobilePostExternalWrite = {
  postUri: string;
  uri: string;
  title: string;
  description: string | null;
  thumbUrl: string | null;
  thumbLocalPath: string | null;
};

export type MobileBookmarkWrite = {
  subjectUri: string;
  postAuthorDid: string | null;
  postAuthorHandle: string | null;
  postText: string | null;
  postCreatedAt: string | null;
  savedAt: number;
  deletedAt: number | null;
};

export type MobileFollowWrite = {
  uri: string;
  cid: string;
  subjectDid: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  savedAt: number;
  unfollowedAt: number | null;
};

export type MobileConversationWrite = {
  convoId: string;
  rev: string | null;
  memberDids: string;
  muted: number;
  lastMessageId: string | null;
  lastMessageText: string | null;
  lastMessageSentAt: string | null;
  lastMessageSenderDid: string | null;
  savedAt: number;
  updatedAt: number;
  leftAt: number | null;
};

export type MobileMessageWrite = {
  messageId: string;
  convoId: string;
  rev: string | null;
  senderDid: string;
  text: string;
  facetsJSON: string | null;
  embedJSON: string | null;
  sentAt: string;
  savedAt: number;
  deletedAt: number | null;
};

export type MobileMediaAssetWrite = {
  contentCid: string;
  mediaType: "image" | "video";
  mimeType: string | null;
  byteLength: number | null;
  localPath: string | null;
  sourceUrl: string | null;
  sourceDid: string | null;
  sourceMetadataJSON: string | null;
  downloadState: "complete" | "failed";
  lastError: string | null;
  downloadedAt: number | null;
};

/** What the archive carries that Mobile has nowhere to put. */
export type UnrestorableContent = {
  /** Blocks and mutes: Mobile stores neither. */
  relationships: number;
  /** Media attached to a chat message, or a profile banner. */
  assets: number;
  /** A selection whose subject record the archive does not carry. */
  selections: number;
};

export type RestoredMobileAccount = {
  identity: {
    did: string;
    handle: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  profiles: MobileProfileWrite[];
  posts: MobilePostWrite[];
  postMedia: MobilePostMediaWrite[];
  postExternals: MobilePostExternalWrite[];
  bookmarks: MobileBookmarkWrite[];
  follows: MobileFollowWrite[];
  conversations: MobileConversationWrite[];
  messages: MobileMessageWrite[];
  mediaAssets: MobileMediaAssetWrite[];
  completeness: "complete" | "incomplete";
  unrestorable: UnrestorableContent;
};

export type TranslationContext = {
  /** What the media-copying pass concluded about each asset, by asset id. */
  placements: Map<string, RestoredAssetPlacement>;
};

export function translateInterchangeToMobileRows(
  snapshot: BlueskyInterchangeSnapshot,
  context: TranslationContext,
): RestoredMobileAccount {
  return new MobileRowBuilder(snapshot, context).build();
}

function millisFrom(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** A name, or nothing: blank is an absence of one rather than an empty one. */
function named(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseJson(value: string | null): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecordObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(
  value: Record<string, unknown> | null,
  field: string,
): string | null {
  const found = value?.[field];
  return typeof found === "string" ? found : null;
}

function numberField(
  value: Record<string, unknown> | null,
  field: string,
): number {
  const found = value?.[field];
  return typeof found === "number" ? found : 0;
}

/** The author DID an AT URI names, which is a fact even without the record. */
function didFromAtUri(uri: string): string | null {
  const match = /^at:\/\/(did:[^/]+)\//.exec(uri);
  return match ? match[1] : null;
}

class MobileRowBuilder {
  private readonly profiles = new Map<string, MobileProfileWrite>();
  private readonly posts = new Map<string, MobilePostWrite>();
  private readonly bookmarks = new Map<string, MobileBookmarkWrite>();
  private readonly postExternals: MobilePostExternalWrite[] = [];
  private readonly postMedia: MobilePostMediaWrite[] = [];
  private readonly mediaAssets = new Map<string, MobileMediaAssetWrite>();
  private readonly follows: MobileFollowWrite[] = [];
  private readonly conversations: MobileConversationWrite[] = [];
  private readonly messages: MobileMessageWrite[] = [];
  private readonly recordsByUri: Map<string, InterchangeRecord>;
  private readonly profilesById: Map<string, InterchangeProfile>;
  private readonly assetsById: Map<string, InterchangeAsset>;
  private readonly subjectByRelationship: Map<string, string>;
  private unrestorableRelationships = 0;
  private unrestorableAssets = 0;
  private unrestorableSelections = 0;

  constructor(
    private readonly snapshot: BlueskyInterchangeSnapshot,
    private readonly context: TranslationContext,
  ) {
    this.recordsByUri = new Map(snapshot.records.map((row) => [row.uri, row]));
    this.profilesById = new Map(snapshot.profiles.map((row) => [row.id, row]));
    this.assetsById = new Map(snapshot.assets.map((row) => [row.id, row]));
    this.subjectByRelationship = new Map(
      snapshot.recordSubjects.map((row) => [
        row.relationship_uri,
        row.subject_record_uri,
      ]),
    );
  }

  build(): RestoredMobileAccount {
    this.addProfiles();
    this.addPosts();
    this.addSelections();
    this.addContext();
    this.addAssets();
    this.addFollows();
    this.addConversations();

    return {
      identity: this.buildIdentity(),
      profiles: [...this.profiles.values()],
      posts: [...this.posts.values()],
      postMedia: this.postMedia,
      postExternals: this.postExternals,
      bookmarks: [...this.bookmarks.values()],
      follows: this.follows,
      conversations: this.conversations,
      messages: this.messages,
      mediaAssets: [...this.mediaAssets.values()],
      completeness: this.snapshot.archive.completeness,
      unrestorable: {
        relationships: this.unrestorableRelationships,
        assets: this.unrestorableAssets,
        selections: this.unrestorableSelections,
      },
    };
  }

  private buildIdentity(): RestoredMobileAccount["identity"] {
    const did = this.snapshot.archive.account_did;
    const profile =
      this.profilesById.get(this.snapshot.identity.current_profile_id) ??
      this.snapshot.profiles.find((row) => row.did === did);
    const restored = profile ? this.profiles.get(profile.did) : undefined;

    return {
      did,
      handle: restored?.handle ?? profile?.handle ?? did,
      // A display name nobody ever set arrives as an empty string, which is an
      // absence rather than a name — the same thing the merge's `populated`
      // rule refuses to treat as an observation. Storing it as nothing is what
      // lets the account fall back to its handle instead of showing a blank.
      displayName: named(restored?.displayName ?? profile?.display_name),
      avatarUrl: restored?.avatarUrl ?? null,
    };
  }

  /**
   * The captured authors a restored record needs to render.
   *
   * Mobile requires a handle and the contract does not, so a profile the
   * archive knows only by its DID keeps the DID in its place. That is what the
   * archive says about the identity, and unlike an empty string it still names
   * somebody in the interface.
   */
  private addProfiles(): void {
    for (const row of this.snapshot.profiles) {
      const capturedAt = millisFrom(row.captured_at) ?? 0;
      this.profiles.set(row.did, {
        did: row.did,
        handle: row.handle ?? row.did,
        displayName: row.display_name,
        avatarUrl: this.avatarUrlFor(row.avatar_asset_id),
        savedAt: capturedAt,
        updatedAt: capturedAt,
      });
      if (row.banner_asset_id) {
        // Mobile has no banner column; saying so beats dropping it silently.
        this.unrestorableAssets += 1;
      }
    }
  }

  /**
   * A profile's avatar, preferring the copy that works with no network.
   *
   * Mobile stores avatars as URLs rather than content-addressed files, so a
   * restored avatar file is referenced by its local URI. When the archive
   * carried no bytes, the source URL is kept: it is what Mobile would have
   * stored anyway, and it costs nothing to leave behind.
   */
  private avatarUrlFor(assetId: string | null): string | null {
    if (!assetId) {
      return null;
    }
    const placement = this.context.placements.get(assetId);
    if (placement?.availability === "restored") {
      return placement.localPath;
    }
    return this.assetsById.get(assetId)?.source_url ?? null;
  }

  private didForProfileId(profileId: string): string | null {
    return this.profilesById.get(profileId)?.did ?? null;
  }

  /**
   * Reference an identity the archive names but never captured a profile for.
   *
   * Mobile's rows point at `profile.did` through foreign keys, so a record
   * whose author was never captured would otherwise take its whole table down
   * with it. The stub holds only what the archive already states: the DID.
   */
  private ensureProfile(did: string): string {
    if (!this.profiles.has(did)) {
      this.profiles.set(did, {
        did,
        handle: did,
        displayName: null,
        avatarUrl: null,
        savedAt: 0,
        updatedAt: 0,
      });
    }
    return did;
  }

  private addPosts(): void {
    for (const record of this.snapshot.records) {
      if (record.record_type === POST_TYPE) {
        this.posts.set(record.uri, this.buildPost(record));
      }
    }
  }

  private buildPost(record: InterchangeRecord): MobilePostWrite {
    const payload = asRecordObject(parseJson(record.payload_json));
    const inner = asRecordObject(payload?.record);
    const metrics = asRecordObject(payload?.metrics);
    const embed = payload?.embed ?? null;
    const observedAt = millisFrom(record.observed_at) ?? 0;
    const langs = Array.isArray(inner?.langs)
      ? (inner.langs as unknown[]).filter(
          (lang): lang is string => typeof lang === "string",
        )
      : [];

    return {
      uri: record.uri,
      // `cid` is required by Mobile and optional in the contract. An empty one
      // means "the archive did not say", which is true, and is not a CID that
      // points at the wrong revision.
      cid: record.cid ?? "",
      authorDid: this.ensureProfile(
        this.didForProfileId(record.author_profile_id) ??
          didFromAtUri(record.uri) ??
          this.snapshot.archive.account_did,
      ),
      text: record.text ?? stringField(inner, "text") ?? "",
      facetsJSON: record.facets_json,
      embedType: stringField(asRecordObject(embed), "$type"),
      embedJSON: embed === null ? null : JSON.stringify(embed),
      langs: langs.length > 0 ? langs.join(",") : null,
      isReply: 0,
      replyParentUri: null,
      replyRootUri: null,
      isQuote: 0,
      quotedPostUri: null,
      isRepost: 0,
      repostUri: null,
      repostCid: null,
      originalPostUri: null,
      likeCount: numberField(metrics, "likeCount"),
      repostCount: numberField(metrics, "repostCount"),
      replyCount: numberField(metrics, "replyCount"),
      quoteCount: numberField(metrics, "quoteCount"),
      viewerLiked: 0,
      likeUri: null,
      viewerReposted: 0,
      viewerBookmarked: 0,
      createdAt: record.created_at,
      savedAt: observedAt,
      deletedPostAt: millisFrom(record.source_deleted_at),
      deletedRepostAt: null,
      deletedLikeAt: null,
      deletedBookmarkAt: null,
    };
  }

  /**
   * Put every selected record back in the category it was saved under.
   *
   * Mobile browses reposts, likes, and bookmarks through viewer state on the
   * post, so that is where a selection has to land for the restored account to
   * be browseable at all. A repost of a post the archive does not carry has
   * nowhere to attach, so it keeps the shape Mobile uses for a repost saved on
   * its own: its own row, pointing at the post it repeated.
   */
  private addSelections(): void {
    for (const selection of this.snapshot.selections) {
      switch (selection.category) {
        case "likes":
          this.restoreLike(selection.subject_id);
          break;
        case "reposts":
          this.restoreRepost(selection.subject_id);
          break;
        case "bookmarks":
          this.restoreBookmark(selection.subject_id, selection.selected_at);
          break;
        case "posts":
        case "chats":
          // Own posts browse by author, and chats by conversation: neither
          // needs a flag the selection would have to carry.
          break;
      }
    }
  }

  private restoreLike(subjectId: string): void {
    const likeRecord = this.likeRecordFor(subjectId);
    const targetUri = likeRecord
      ? this.subjectUriFor(likeRecord)
      : subjectId;
    const post = targetUri ? this.posts.get(targetUri) : undefined;
    if (!post) {
      // Nothing to hang the like on: the archive selected a post it does not
      // carry. Counted rather than dropped, so the restore can say so.
      this.unrestorableSelections += 1;
      return;
    }
    post.viewerLiked = 1;
    post.likeUri = likeRecord?.uri ?? null;
    post.deletedLikeAt =
      millisFrom(likeRecord?.source_deleted_at ?? null) ?? post.deletedLikeAt;
  }

  private likeRecordFor(subjectId: string): InterchangeRecord | undefined {
    const record = this.recordsByUri.get(subjectId);
    return record?.record_type === LIKE_TYPE ? record : undefined;
  }

  private restoreRepost(subjectId: string): void {
    const record = this.recordsByUri.get(subjectId);
    if (!record || record.record_type !== REPOST_TYPE) {
      // A selection naming a post directly is a repost Cyd saved as the post
      // itself, which is already in `posts`.
      const post = this.posts.get(subjectId);
      if (!post) {
        this.unrestorableSelections += 1;
        return;
      }
      post.viewerReposted = 1;
      return;
    }

    const subjectUri = this.subjectUriFor(record);
    const subject = subjectUri ? this.posts.get(subjectUri) : undefined;
    const deletedRepostAt = millisFrom(record.source_deleted_at);

    if (subject) {
      subject.viewerReposted = 1;
      subject.repostUri = record.uri;
      subject.repostCid = record.cid;
      subject.deletedRepostAt = deletedRepostAt;
      return;
    }

    this.posts.set(record.uri, {
      ...this.buildPost(record),
      text: "",
      isRepost: 1,
      repostUri: record.uri,
      repostCid: record.cid,
      originalPostUri: subjectUri,
      viewerReposted: 1,
      deletedPostAt: null,
      deletedRepostAt,
    });
  }

  /**
   * Where a relationship record points, whether or not the link survived.
   *
   * `record_subjects` is a foreign key, so an export drops the link when it
   * does not carry the subject. The URI itself survives in `payload_json`,
   * which is exactly the case a repost of somebody else's post produces.
   */
  private subjectUriFor(record: InterchangeRecord): string | null {
    const linked = this.subjectByRelationship.get(record.uri);
    if (linked) {
      return linked;
    }
    const payload = asRecordObject(parseJson(record.payload_json));
    const inner = asRecordObject(payload?.record);
    return stringField(asRecordObject(inner?.subject), "uri");
  }

  private restoreBookmark(subjectId: string, selectedAt: string): void {
    const record = this.recordsByUri.get(subjectId);
    const targetUri =
      record && record.record_type !== POST_TYPE
        ? this.subjectUriFor(record)
        : subjectId;
    if (!targetUri) {
      this.unrestorableSelections += 1;
      return;
    }

    const post = this.posts.get(targetUri);
    if (!post) {
      // Mobile browses bookmarks through the post's own viewer state, so a
      // bookmark of a record the archive does not carry has nowhere to show.
      this.unrestorableSelections += 1;
      return;
    }
    const deletedAt = millisFrom(
      record && record.record_type !== POST_TYPE
        ? record.source_deleted_at
        : null,
    );
    post.viewerBookmarked = 1;
    post.deletedBookmarkAt = deletedAt;

    const target = this.recordsByUri.get(targetUri);
    const authorDid = target
      ? this.didForProfileId(target.author_profile_id)
      : didFromAtUri(targetUri);

    this.bookmarks.set(targetUri, {
      subjectUri: targetUri,
      postAuthorDid: authorDid,
      postAuthorHandle: authorDid
        ? this.profiles.get(authorDid)?.handle ?? null
        : null,
      postText: target?.text ?? post.text ?? null,
      postCreatedAt: target?.created_at ?? post.createdAt ?? null,
      savedAt: millisFrom(selectedAt) ?? 0,
      deletedAt,
    });
  }

  /**
   * The bounded context a record needs to make sense on its own.
   *
   * Reply and quote targets are read from the record's own payload, because
   * that is where Mobile keeps them and because the URI is there even when the
   * referenced record is not part of the backup. The context rows say which
   * kind of reference each one is.
   */
  private addContext(): void {
    for (const context of this.snapshot.recordContext) {
      const post = this.posts.get(context.record_uri);
      const record = this.recordsByUri.get(context.record_uri);
      if (!post || !record) {
        continue;
      }
      const payload = asRecordObject(parseJson(record.payload_json));
      const inner = asRecordObject(payload?.record);

      if (context.kind === "reply_parent") {
        const reply = asRecordObject(inner?.reply);
        post.isReply = 1;
        post.replyParentUri =
          context.context_record_uri ??
          stringField(asRecordObject(reply?.parent), "uri");
        post.replyRootUri =
          stringField(asRecordObject(reply?.root), "uri") ?? post.replyParentUri;
        continue;
      }

      if (context.kind === "quote") {
        const embedded = asRecordObject(asRecordObject(payload?.embed)?.record);
        post.isQuote = 1;
        post.quotedPostUri =
          context.context_record_uri ?? stringField(embedded, "uri");
        continue;
      }

      this.addExternalContext(context.record_uri, context.external_json);
    }
  }

  private addExternalContext(
    postUri: string,
    externalJson: string | null,
  ): void {
    const external = asRecordObject(parseJson(externalJson));
    const uri = stringField(external, "uri");
    if (!uri) {
      return;
    }
    this.postExternals.push({
      postUri,
      uri,
      title: stringField(external, "title") ?? "",
      description: stringField(external, "description"),
      thumbUrl: stringField(external, "thumbUrl"),
      thumbLocalPath: null,
    });
  }

  /**
   * Every asset the archive relates to a record, and where its bytes ended up.
   *
   * An asset Cyd could not place is not dropped: it becomes a failed download
   * pointing at the source URL, which is the state Mobile already uses for
   * media it has not managed to preserve. That keeps the gap visible in the
   * interface and leaves saving able to fetch it later.
   */
  private addAssets(): void {
    const previewByPost = new Map<string, string>();

    for (const link of this.snapshot.recordAssets) {
      const asset = this.assetsById.get(link.asset_id);
      if (!asset) {
        continue;
      }
      if (link.owner_type === "profile") {
        // A profile's own media is restored from `profiles.avatar_asset_id`,
        // and its banner was counted there: Mobile has no column for one.
        continue;
      }
      if (link.owner_type !== "record" || !this.posts.has(link.owner_id)) {
        // A chat message's media has no table in Mobile, and a record Cyd did
        // not restore has nothing to attach anything to.
        this.unrestorableAssets += 1;
        continue;
      }
      const post = this.posts.get(link.owner_id) as MobilePostWrite;

      if (link.role === "preview" || link.role === "thumbnail") {
        const placement = this.context.placements.get(asset.id);
        if (placement?.availability === "restored") {
          previewByPost.set(link.owner_id, placement.localPath);
        }
        continue;
      }
      if (link.role !== "content") {
        this.unrestorableAssets += 1;
        continue;
      }

      this.addMediaAsset(asset, post.authorDid);
      this.postMedia.push(this.buildPostMedia(link.owner_id, link.position, asset));
    }

    for (const external of this.postExternals) {
      external.thumbLocalPath = previewByPost.get(external.postUri) ?? null;
    }
  }

  /**
   * @param sourceDid The repository a retry would fetch the blob from, which
   * is the author of the record carrying it rather than this account: media on
   * a liked or bookmarked post lives in somebody else's repository. An asset
   * two records share keeps the first author it arrived with, the same way
   * Mobile's own `media_asset` row does.
   */
  private addMediaAsset(asset: InterchangeAsset, sourceDid: string): void {
    if (this.mediaAssets.has(asset.id)) {
      return;
    }
    const placement = this.context.placements.get(asset.id);
    const restored = placement?.availability === "restored";

    this.mediaAssets.set(asset.id, {
      contentCid: asset.id,
      mediaType: asset.kind === "video" ? "video" : "image",
      mimeType: asset.media_type,
      byteLength: asset.byte_count,
      localPath: restored ? placement.localPath : null,
      sourceUrl: asset.source_url,
      sourceDid,
      sourceMetadataJSON: JSON.stringify({
        thumbUrl: null,
        width: asset.width,
        height: asset.height,
        alt: asset.alt_text,
      }),
      downloadState: restored ? "complete" : "failed",
      lastError: restored
        ? null
        : placement?.reason ??
          asset.unavailable_reason ??
          "This file was not part of the archive.",
      downloadedAt: null,
    });
  }

  private buildPostMedia(
    postUri: string,
    position: number,
    asset: InterchangeAsset,
  ): MobilePostMediaWrite {
    const isVideo = asset.kind === "video";
    return {
      postUri,
      position,
      mediaType: isVideo ? "video" : "image",
      blobCid: asset.id,
      mimeType: asset.media_type,
      alt: asset.alt_text,
      width: asset.width,
      height: asset.height,
      thumbUrl: null,
      fullsizeUrl: isVideo ? null : asset.source_url,
      playlistUrl: isVideo ? asset.source_url : null,
      downloadedAt: null,
      assetCid: asset.id,
    };
  }

  /**
   * Follows, and the relationships Mobile cannot hold.
   *
   * Mobile's `follow` table exists but nothing writes it today, so a follow
   * from a Desktop archive lands somewhere no screen reads yet. It is restored
   * anyway: the column is there, and discarding Bluesky saved data because
   * this client has not caught up would make the import lossy. Blocks and mutes have no
   * table at all, so they are counted and reported instead.
   */
  private addFollows(): void {
    for (const relationship of this.snapshot.relationships) {
      if (relationship.kind !== "follow") {
        this.unrestorableRelationships += 1;
        continue;
      }
      this.ensureProfile(relationship.subject_did);
      const profile = this.profiles.get(relationship.subject_did);
      this.follows.push({
        uri: relationship.uri,
        cid: "",
        subjectDid: relationship.subject_did,
        handle: profile?.handle ?? relationship.subject_did,
        displayName: profile?.displayName ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
        createdAt: relationship.created_at ?? relationship.observed_at,
        savedAt: millisFrom(relationship.observed_at) ?? 0,
        unfollowedAt: millisFrom(relationship.source_deleted_at),
      });
    }
  }

  private addConversations(): void {
    const membersByConversation = new Map<string, string[]>();
    for (const member of this.snapshot.conversationMembers) {
      const did = this.didForProfileId(member.profile_id);
      if (!did) {
        continue;
      }
      const members = membersByConversation.get(member.conversation_id) ?? [];
      members.push(this.ensureProfile(did));
      membersByConversation.set(member.conversation_id, members);
    }

    const known = new Set(this.snapshot.conversations.map((row) => row.id));
    for (const message of this.snapshot.messages) {
      if (!known.has(message.conversation_id)) {
        continue;
      }
      const payload = asRecordObject(parseJson(message.payload_json));
      const embed = payload?.embed ?? null;
      this.messages.push({
        messageId: message.id,
        convoId: message.conversation_id,
        rev: null,
        senderDid: this.ensureProfile(
          this.didForProfileId(message.sender_profile_id) ??
            this.snapshot.archive.account_did,
        ),
        text: message.text ?? "",
        facetsJSON: message.facets_json,
        embedJSON: embed === null ? null : JSON.stringify(embed),
        sentAt: message.sent_at,
        savedAt: millisFrom(message.observed_at) ?? 0,
        deletedAt: millisFrom(message.source_deleted_at),
      });
    }

    for (const conversation of this.snapshot.conversations) {
      const latest = this.latestMessageIn(conversation.id);
      this.conversations.push({
        convoId: conversation.id,
        rev: conversation.rev,
        memberDids: JSON.stringify(
          membersByConversation.get(conversation.id) ?? [],
        ),
        // Muting is a live Bluesky preference rather than Bluesky saved data, so a
        // restored conversation starts unmuted rather than claiming to know.
        muted: 0,
        lastMessageId: latest?.messageId ?? null,
        lastMessageText: latest?.text ?? null,
        lastMessageSentAt: latest?.sentAt ?? null,
        lastMessageSenderDid: latest?.senderDid ?? null,
        savedAt: millisFrom(conversation.first_observed_at) ?? 0,
        updatedAt:
          millisFrom(conversation.observed_at) ??
          millisFrom(conversation.first_observed_at) ??
          0,
        leftAt: millisFrom(conversation.source_deleted_at),
      });
    }
  }

  /** The most recent message Cyd has, which is the preview a chat list shows. */
  private latestMessageIn(convoId: string): MobileMessageWrite | null {
    let latest: MobileMessageWrite | null = null;
    for (const message of this.messages) {
      if (message.convoId !== convoId) {
        continue;
      }
      if (
        latest === null ||
        (millisFrom(message.sentAt) ?? 0) >= (millisFrom(latest.sentAt) ?? 0)
      ) {
        latest = message;
      }
    }
    return latest;
  }
}

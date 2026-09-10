import { previewAssetKey, type ResolvedAsset } from "./assets";
import type {
  MobileAccountSnapshot,
  MobileMediaAssetRow,
  MobilePostMediaRow,
  MobilePostRow,
} from "./mobile-snapshot";

/**
 * Translating Bluesky saved data into the version 2 interchange model.
 *
 * This is the other half of the adapter ADR 0002 describes, and it is pure: in
 * go Mobile's rows and what the hashing pass learned about each asset, out come
 * interchange rows. No database, no filesystem, no clock.
 *
 * Two rules shape most of the decisions here:
 *
 * 1. Nothing is invented. Where Mobile does not observe something the contract
 *    can hold — a like's creation time, a reply parent Cyd never saved — the
 *    export says so by leaving it out or by falling back to a fact it does
 *    have, such as the author DID that an AT URI already names. `docs/
 *    bluesky-archive-fixtures.md` lists what Mobile cannot populate.
 * 2. Nothing private leaks. Only the columns the snapshot reader selected are
 *    visible here, so local paths, jobs, and UI state cannot reach an archive
 *    even by accident.
 */

export type ArchiveRow = {
  format: "cyd-archive";
  platform: "bluesky";
  version: 2;
  created_at: string;
  account_did: string;
  account_uuid: string;
  completeness: "complete" | "incomplete";
};

export type IdentityRow = { did: string; current_profile_id: string };

export type ProfileRow = {
  id: string;
  did: string;
  handle: string | null;
  display_name: string | null;
  description: string | null;
  avatar_asset_id: string | null;
  banner_asset_id: string | null;
  captured_at: string;
};

export type RecordRow = {
  uri: string;
  cid: string | null;
  record_type: string;
  author_profile_id: string;
  indexed_at: string | null;
  created_at: string;
  first_observed_at: string;
  observed_at: string;
  source_deleted_at: string | null;
  text: string | null;
  facets_json: string | null;
  payload_json: string;
};

export type SelectionCategory =
  | "posts"
  | "reposts"
  | "likes"
  | "bookmarks"
  | "chats";

export type SelectionRow = {
  category: SelectionCategory;
  subject_id: string;
  selected_at: string;
};

export type RecordSubjectRow = {
  relationship_uri: string;
  subject_record_uri: string;
};

export type RecordContextRow = {
  record_uri: string;
  kind: "reply_parent" | "quote" | "external";
  context_record_uri: string | null;
  context_profile_id: string | null;
  external_json: string | null;
};

export type ConversationRow = {
  id: string;
  rev: string | null;
  first_observed_at: string;
  observed_at: string;
  source_deleted_at: string | null;
};

export type ConversationMemberRow = {
  conversation_id: string;
  profile_id: string;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_profile_id: string;
  sent_at: string;
  observed_at: string;
  source_deleted_at: string | null;
  text: string | null;
  facets_json: string | null;
  payload_json: string;
};

export type RelationshipRow = {
  uri: string;
  kind: "follow" | "block" | "mute";
  actor_did: string;
  subject_did: string;
  created_at: string | null;
  observed_at: string;
  source_deleted_at: string | null;
};

export type AssetRow = {
  id: string;
  kind: "image" | "preview" | "thumbnail" | "video";
  media_type: string;
  byte_count: number | null;
  sha256: string | null;
  archive_path: string | null;
  availability: "available" | "missing" | "unavailable";
  unavailable_reason: string | null;
  source_url: string | null;
  width: number | null;
  height: number | null;
  alt_text: string | null;
};

export type RecordAssetRow = {
  owner_type: "record" | "message" | "profile";
  owner_id: string;
  asset_id: string;
  role: "content" | "preview" | "thumbnail" | "avatar" | "banner";
  position: number;
};

export const PORTABLE_SETTING_KEYS = [
  "save_posts",
  "save_reposts",
  "save_likes",
  "save_bookmarks",
  "save_chats",
  "delete_posts",
  "delete_reposts",
  "delete_likes",
  "delete_bookmarks",
  "delete_chats",
  "delete_follows",
] as const;

export type PortableSettingKey = (typeof PORTABLE_SETTING_KEYS)[number];

export type PortableSettings = Partial<Record<PortableSettingKey, boolean>>;

export type PortableSettingRow = { key: PortableSettingKey; value_json: string };

/** One media file to copy into the archive, already hashed. */
export type ArchivePayload = {
  archivePath: string;
  localPath: string;
  byteCount: number;
  crc32: number;
  sha256: string;
};

export type BlueskyArchiveTranslationContext = {
  accountDid: string;
  accountUuid: string;
  /** When this export was taken; also the archive's `created_at`. */
  createdAt: Date;
  /** What the hashing pass concluded about each preserved asset, by CID. */
  assets: Map<string, ResolvedAsset>;
  portableSettings: PortableSettings;
};

export type BlueskyInterchangeContent = {
  archive: ArchiveRow;
  identity: IdentityRow;
  profiles: ProfileRow[];
  records: RecordRow[];
  selections: SelectionRow[];
  recordSubjects: RecordSubjectRow[];
  recordContext: RecordContextRow[];
  conversations: ConversationRow[];
  conversationMembers: ConversationMemberRow[];
  messages: MessageRow[];
  relationships: RelationshipRow[];
  assets: AssetRow[];
  recordAssets: RecordAssetRow[];
  portableSettings: PortableSettingRow[];
  /** Media the packaging step must copy in, one entry per unique digest. */
  payloads: ArchivePayload[];
  completeness: "complete" | "incomplete";
};

const POST_TYPE = "app.bsky.feed.post";
const REPOST_TYPE = "app.bsky.feed.repost";
const LIKE_TYPE = "app.bsky.feed.like";

export function profileIdForDid(did: string): string {
  return `profile:${did}`;
}

/** The author DID an AT URI names, which is a fact even without the record. */
function didFromAtUri(uri: string): string | null {
  const match = /^at:\/\/(did:[^/]+)\//.exec(uri);
  return match ? match[1] : null;
}

function isoFromMillis(value: number | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

/**
 * Put a stored timestamp into the RFC 3339 UTC form the contract uses.
 *
 * A value Cyd cannot parse is passed through untouched rather than replaced:
 * the original is at least what Bluesky said, and a substituted "now" would be
 * a timestamp nobody observed.
 */
function normalizeTimestamp(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
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

/** Sort by one string field, so an unchanged account exports the same rows. */
function compareBy<T>(field: (row: T) => string) {
  return (left: T, right: T): number => {
    const a = field(left);
    const b = field(right);
    return a < b ? -1 : a > b ? 1 : 0;
  };
}

function dropNulls(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined),
  );
}

export function translateBlueskyAccountToInterchange(
  snapshot: MobileAccountSnapshot,
  context: BlueskyArchiveTranslationContext,
): BlueskyInterchangeContent {
  const exportedAt = context.createdAt.toISOString();
  const builder = new InterchangeBuilder(snapshot, context, exportedAt);
  return builder.build();
}

class InterchangeBuilder {
  private readonly profiles = new Map<string, ProfileRow>();
  private readonly records = new Map<string, RecordRow>();
  // Keyed by their interchange primary keys. The same repost can reach the
  // translation twice — once as a record of its own, once as the viewer state
  // on the post it points at — and the archive must say it once.
  private readonly selections = new Map<string, SelectionRow>();
  private readonly recordSubjects = new Map<string, RecordSubjectRow>();
  private readonly recordContext: RecordContextRow[] = [];
  private readonly relationships: RelationshipRow[] = [];
  private readonly conversations: ConversationRow[] = [];
  private readonly conversationMembers: ConversationMemberRow[] = [];
  private readonly messages: MessageRow[] = [];

  constructor(
    private readonly snapshot: MobileAccountSnapshot,
    private readonly context: BlueskyArchiveTranslationContext,
    private readonly exportedAt: string,
  ) {}

  build(): BlueskyInterchangeContent {
    this.addCapturedProfiles();
    const currentProfileId = this.ensureProfile(this.context.accountDid);

    this.addPosts();
    this.addBookmarks();
    this.addContext();
    this.addFollows();
    this.addConversations();

    const media = this.buildAssets();
    const completeness = media.assets.every(
      (asset) => asset.availability === "available",
    )
      ? "complete"
      : "incomplete";

    return {
      archive: {
        format: "cyd-archive",
        platform: "bluesky",
        version: 2,
        created_at: this.exportedAt,
        account_did: this.context.accountDid,
        account_uuid: this.context.accountUuid,
        completeness,
      },
      identity: {
        did: this.context.accountDid,
        current_profile_id: currentProfileId,
      },
      profiles: [...this.profiles.values()].sort(compareBy((row) => row.id)),
      records: [...this.records.values()].sort(compareBy((row) => row.uri)),
      selections: [...this.selections.values()],
      recordSubjects: this.knownRecordSubjects(),
      recordContext: this.recordContext,
      conversations: this.conversations,
      conversationMembers: this.conversationMembers,
      messages: this.messages,
      relationships: this.relationships,
      assets: media.assets,
      recordAssets: media.recordAssets,
      portableSettings: this.buildPortableSettings(),
      payloads: media.payloads,
      completeness,
    };
  }

  /**
   * Drop links to a record this archive does not contain.
   *
   * `record_subjects.subject_record_uri` is a foreign key, so a repost of a
   * post Cyd never saved would abort the whole export. Losing one link is the
   * right trade against losing the archive, and the repost record itself still
   * carries its subject URI in `payload_json`. The pruning happens here rather
   * than at insertion time because a later post row can supply the record an
   * earlier one referenced.
   */
  private knownRecordSubjects(): RecordSubjectRow[] {
    return [...this.recordSubjects.values()].filter((row) =>
      this.records.has(row.subject_record_uri),
    );
  }

  private addCapturedProfiles(): void {
    for (const row of this.snapshot.profiles) {
      this.profiles.set(profileIdForDid(row.did), {
        id: profileIdForDid(row.did),
        did: row.did,
        handle: row.handle,
        display_name: row.displayName,
        description: null,
        avatar_asset_id: null,
        banner_asset_id: null,
        captured_at:
          isoFromMillis(row.updatedAt) ??
          isoFromMillis(row.savedAt) ??
          this.exportedAt,
      });
    }
  }

  /**
   * Reference a Bluesky identity, capturing what little a URI tells us if that
   * is all Cyd has. A later, fuller capture fills the stub in rather than
   * replacing it, so ordering between callers does not matter.
   */
  private ensureProfile(
    did: string,
    known: { handle?: string | null } = {},
  ): string {
    const id = profileIdForDid(did);
    const existing = this.profiles.get(id);
    if (existing) {
      if (!existing.handle && known.handle) {
        existing.handle = known.handle;
      }
      return id;
    }
    this.profiles.set(id, {
      id,
      did,
      handle: known.handle ?? null,
      display_name: null,
      description: null,
      avatar_asset_id: null,
      banner_asset_id: null,
      captured_at: this.exportedAt,
    });
    return id;
  }

  private addPosts(): void {
    for (const row of this.snapshot.posts) {
      const observedAt = isoFromMillis(row.savedAt) ?? this.exportedAt;
      const authorProfileId = this.ensureProfile(row.authorDid);
      const isRepostRecord = row.isRepost === 1;

      this.records.set(row.uri, {
        uri: row.uri,
        cid: row.cid || null,
        record_type: isRepostRecord ? REPOST_TYPE : POST_TYPE,
        author_profile_id: authorProfileId,
        indexed_at: null,
        created_at: normalizeTimestamp(row.createdAt),
        first_observed_at: observedAt,
        observed_at: observedAt,
        source_deleted_at: isoFromMillis(
          isRepostRecord ? row.deletedRepostAt : row.deletedPostAt,
        ),
        text: isRepostRecord ? null : row.text,
        facets_json: row.facetsJSON,
        payload_json: JSON.stringify(this.buildPostPayload(row)),
      });

      if (isRepostRecord) {
        this.select("reposts", row.uri, observedAt);
        if (row.originalPostUri) {
          this.recordSubjects.set(row.uri, {
            relationship_uri: row.uri,
            subject_record_uri: row.originalPostUri,
          });
        }
        continue;
      }

      if (row.authorDid === this.context.accountDid) {
        this.select("posts", row.uri, observedAt);
      }
      if (row.viewerReposted === 1 && row.repostUri) {
        this.addRelationshipRecord({
          uri: row.repostUri,
          cid: row.repostCid,
          type: REPOST_TYPE,
          subjectUri: row.uri,
          subjectCid: row.cid,
          category: "reposts",
          observedAt,
          sourceDeletedAt: isoFromMillis(row.deletedRepostAt),
        });
      }
      if (row.viewerLiked === 1) {
        if (row.likeUri) {
          this.addRelationshipRecord({
            uri: row.likeUri,
            cid: null,
            type: LIKE_TYPE,
            subjectUri: row.uri,
            subjectCid: row.cid,
            category: "likes",
            observedAt,
            sourceDeletedAt: isoFromMillis(row.deletedLikeAt),
          });
        } else {
          // Cyd knows the post was liked but never saw the like's own URI, so
          // the selection points at the post rather than inventing a record.
          this.select("likes", row.uri, observedAt);
        }
      }
    }
  }

  /**
   * Add the like or repost record that made a post part of the backup.
   *
   * Mobile stores the relationship's URI but never its creation time, so
   * `created_at` is the moment Cyd observed it. That is a real timestamp with a
   * weaker meaning than Bluesky's own, which is why it is called out in the
   * fixtures documentation rather than passed off as the record's age.
   */
  private addRelationshipRecord(options: {
    uri: string;
    cid: string | null;
    type: typeof REPOST_TYPE | typeof LIKE_TYPE;
    subjectUri: string;
    subjectCid: string | null;
    category: SelectionCategory;
    observedAt: string;
    sourceDeletedAt: string | null;
  }): void {
    // A repost Cyd saved as a record of its own is the better version of the
    // same fact: it has the CID and the real creation time. Only fill in for
    // one that was never saved on its own.
    if (!this.records.has(options.uri)) {
      this.records.set(options.uri, this.buildRelationshipRecord(options));
    }
    this.recordSubjects.set(options.uri, {
      relationship_uri: options.uri,
      subject_record_uri: options.subjectUri,
    });
    this.select(options.category, options.uri, options.observedAt);
  }

  private buildRelationshipRecord(options: {
    uri: string;
    cid: string | null;
    type: typeof REPOST_TYPE | typeof LIKE_TYPE;
    subjectUri: string;
    subjectCid: string | null;
    observedAt: string;
    sourceDeletedAt: string | null;
  }): RecordRow {
    return {
      uri: options.uri,
      cid: options.cid,
      record_type: options.type,
      author_profile_id: this.ensureProfile(this.context.accountDid),
      indexed_at: null,
      created_at: options.observedAt,
      first_observed_at: options.observedAt,
      observed_at: options.observedAt,
      source_deleted_at: options.sourceDeletedAt,
      text: null,
      facets_json: null,
      payload_json: JSON.stringify({
        record: {
          $type: options.type,
          subject: dropNulls({
            uri: options.subjectUri,
            cid: options.subjectCid,
          }),
        },
      }),
    };
  }

  private buildPostPayload(row: MobilePostRow): Record<string, unknown> {
    const record: Record<string, unknown> = {
      $type: row.isRepost === 1 ? REPOST_TYPE : POST_TYPE,
    };
    if (row.isRepost === 1) {
      record.createdAt = normalizeTimestamp(row.createdAt);
      if (row.originalPostUri) {
        record.subject = { uri: row.originalPostUri };
      }
    } else {
      record.text = row.text;
      record.createdAt = normalizeTimestamp(row.createdAt);
      if (row.langs) {
        record.langs = row.langs.split(",");
      }
      if (row.replyParentUri || row.replyRootUri) {
        record.reply = dropNulls({
          parent: row.replyParentUri ? { uri: row.replyParentUri } : null,
          root: row.replyRootUri ? { uri: row.replyRootUri } : null,
        });
      }
    }

    const payload: Record<string, unknown> = { record };
    const embed = parseJson(row.embedJSON);
    if (embed !== null) {
      payload.embed = embed;
    }
    payload.metrics = {
      likeCount: row.likeCount,
      repostCount: row.repostCount,
      replyCount: row.replyCount,
      quoteCount: row.quoteCount,
    };
    return payload;
  }

  /**
   * Bookmarks, which Mobile knows only by what they point at.
   *
   * There is no bookmark record URI in Mobile's storage, so the selection names
   * the bookmarked post directly. When that post was never saved in full, the
   * denormalized author, text, and creation time the bookmark carries are
   * enough for a real record — none of it is guessed.
   */
  private addBookmarks(): void {
    for (const row of this.snapshot.bookmarks) {
      const observedAt = isoFromMillis(row.savedAt) ?? this.exportedAt;

      if (this.records.has(row.subjectUri)) {
        this.select("bookmarks", row.subjectUri, observedAt);
        continue;
      }
      const authorDid = row.postAuthorDid ?? didFromAtUri(row.subjectUri);
      if (!authorDid) {
        // Without an author there is no honest record to write, and a
        // selection pointing at nothing is worse than one fewer bookmark.
        continue;
      }
      this.select("bookmarks", row.subjectUri, observedAt);
      this.records.set(row.subjectUri, {
        uri: row.subjectUri,
        cid: null,
        record_type: POST_TYPE,
        author_profile_id: this.ensureProfile(authorDid, {
          handle: row.postAuthorHandle,
        }),
        indexed_at: null,
        created_at: row.postCreatedAt
          ? normalizeTimestamp(row.postCreatedAt)
          : observedAt,
        first_observed_at: observedAt,
        observed_at: observedAt,
        source_deleted_at: null,
        text: row.postText,
        facets_json: null,
        payload_json: JSON.stringify({
          record: dropNulls({
            $type: POST_TYPE,
            text: row.postText,
            createdAt: row.postCreatedAt
              ? normalizeTimestamp(row.postCreatedAt)
              : observedAt,
          }),
        }),
      });
    }
  }

  /**
   * The bounded context a record needs to make sense on its own.
   *
   * When the referenced record is part of the backup, the context points at it.
   * When it is not, the context still names its author, because the AT URI says
   * who that is. Nothing recurses: a reply parent's own parent is not pulled in.
   */
  private addContext(): void {
    for (const row of this.snapshot.posts) {
      if (row.isRepost === 1) {
        continue;
      }
      if (row.isReply === 1 && row.replyParentUri) {
        this.addReferenceContext(row.uri, "reply_parent", row.replyParentUri);
      }
      if (row.isQuote === 1 && row.quotedPostUri) {
        this.addReferenceContext(row.uri, "quote", row.quotedPostUri);
      }
    }

    for (const row of this.snapshot.postExternals) {
      if (!this.records.has(row.postUri)) {
        continue;
      }
      this.recordContext.push({
        record_uri: row.postUri,
        kind: "external",
        context_record_uri: null,
        context_profile_id: null,
        external_json: JSON.stringify(
          dropNulls({
            uri: row.uri,
            title: row.title,
            description: row.description,
            thumbUrl: row.thumbUrl,
          }),
        ),
      });
    }
  }

  private addReferenceContext(
    recordUri: string,
    kind: "reply_parent" | "quote",
    referencedUri: string,
  ): void {
    const referenced = this.records.get(referencedUri);
    const authorDid = referenced
      ? this.profiles.get(referenced.author_profile_id)?.did
      : didFromAtUri(referencedUri);

    this.recordContext.push({
      record_uri: recordUri,
      kind,
      context_record_uri: referenced ? referencedUri : null,
      context_profile_id: authorDid ? this.ensureProfile(authorDid) : null,
      external_json: null,
    });
  }

  private addFollows(): void {
    for (const row of this.snapshot.follows) {
      this.ensureProfile(row.subjectDid, { handle: row.handle });
      this.relationships.push({
        uri: row.uri,
        kind: "follow",
        actor_did: this.context.accountDid,
        subject_did: row.subjectDid,
        created_at: row.createdAt ? normalizeTimestamp(row.createdAt) : null,
        observed_at: isoFromMillis(row.savedAt) ?? this.exportedAt,
        source_deleted_at: isoFromMillis(row.unfollowedAt),
      });
    }
  }

  private addConversations(): void {
    const known = new Set<string>();

    for (const row of this.snapshot.conversations) {
      const firstObserved = isoFromMillis(row.savedAt) ?? this.exportedAt;
      known.add(row.convoId);
      this.conversations.push({
        id: row.convoId,
        rev: row.rev,
        first_observed_at: firstObserved,
        observed_at: isoFromMillis(row.updatedAt) ?? firstObserved,
        // Leaving a conversation calls `chat.bsky.convo.leaveConvo` before
        // `leftAt` is stamped, so it is removal at the source, not a local flag.
        source_deleted_at: isoFromMillis(row.leftAt),
      });
      this.select("chats", row.convoId, firstObserved);

      const members = parseJson(row.memberDids);
      const seen = new Set<string>();
      if (Array.isArray(members)) {
        for (const member of members) {
          if (typeof member !== "string" || seen.has(member)) {
            continue;
          }
          seen.add(member);
          this.conversationMembers.push({
            conversation_id: row.convoId,
            profile_id: this.ensureProfile(member),
          });
        }
      }
    }

    for (const row of this.snapshot.messages) {
      if (!known.has(row.convoId)) {
        continue;
      }
      const observedAt = isoFromMillis(row.savedAt) ?? this.exportedAt;
      const embed = parseJson(row.embedJSON);
      this.messages.push({
        id: row.messageId,
        conversation_id: row.convoId,
        sender_profile_id: this.ensureProfile(row.senderDid),
        sent_at: normalizeTimestamp(row.sentAt),
        observed_at: observedAt,
        source_deleted_at: isoFromMillis(row.deletedAt),
        text: row.text,
        facets_json: row.facetsJSON,
        payload_json: JSON.stringify(
          dropNulls({
            record: { $type: "chat.bsky.convo.defs#messageView", text: row.text },
            embed,
          }),
        ),
      });
    }
  }

  /**
   * Every asset an exported record refers to, each unique file exactly once.
   *
   * Deduplication happens twice over: Mobile already stores one file per blob
   * CID within an account (ADR 0007), and two files that turn out to hash the
   * same collapse here, because the interchange model keys assets by digest.
   *
   * Record media and link preview thumbnails both land here, from different
   * Mobile storage. A preview Cyd never managed to download is not an asset at
   * all — its URL stays in the record's external context, and its absence does
   * not make the archive incomplete, because Mobile never counted it as part of
   * the Bluesky saved data either.
   */
  private buildAssets(): {
    assets: AssetRow[];
    recordAssets: RecordAssetRow[];
    payloads: ArchivePayload[];
  } {
    const metadata = new Map<string, MobileMediaAssetRow>(
      this.snapshot.mediaAssets.map((row) => [row.contentCid, row]),
    );
    const assets: AssetRow[] = [];
    const recordAssets: RecordAssetRow[] = [];
    const payloads: ArchivePayload[] = [];
    const assetIdByKey = new Map<string, string>();
    const assetIdByDigest = new Map<string, string>();

    /** Add an asset once, collapsing anything that hashes the same. */
    const register = (key: string, build: (resolved: ResolvedAsset | undefined) => AssetRow): string => {
      const existing = assetIdByKey.get(key);
      if (existing) {
        return existing;
      }

      const resolved = this.context.assets.get(key);
      const row = build(resolved);
      const duplicate = row.sha256 ? assetIdByDigest.get(row.sha256) : undefined;

      const assetId = duplicate ?? row.id;
      if (!duplicate) {
        assets.push(row);
        if (row.sha256 && row.archive_path && resolved?.availability === "available") {
          assetIdByDigest.set(row.sha256, row.id);
          payloads.push({
            archivePath: row.archive_path,
            localPath: resolved.localPath,
            byteCount: resolved.byteCount,
            crc32: resolved.crc32,
            sha256: row.sha256,
          });
        }
      }
      assetIdByKey.set(key, assetId);
      return assetId;
    };

    for (const media of this.snapshot.postMedia) {
      if (!media.assetCid || !this.records.has(media.postUri)) {
        continue;
      }
      const assetId = register(media.assetCid, (resolved) =>
        this.buildMediaAssetRow(
          media.assetCid as string,
          metadata.get(media.assetCid as string),
          media,
          resolved,
        ),
      );
      recordAssets.push({
        owner_type: "record",
        owner_id: media.postUri,
        asset_id: assetId,
        role: "content",
        position: media.position,
      });
    }

    for (const external of this.snapshot.postExternals) {
      if (!this.records.has(external.postUri)) {
        continue;
      }
      const key = previewAssetKey(external.postUri);
      if (!this.context.assets.has(key)) {
        continue;
      }
      const assetId = register(key, (resolved) =>
        this.buildPreviewAssetRow(key, external.thumbUrl, resolved),
      );
      recordAssets.push({
        owner_type: "record",
        owner_id: external.postUri,
        asset_id: assetId,
        role: "preview",
        position: 0,
      });
    }

    return { assets, recordAssets, payloads };
  }

  private buildMediaAssetRow(
    contentCid: string,
    metadata: MobileMediaAssetRow | undefined,
    media: MobilePostMediaRow,
    resolved: ResolvedAsset | undefined,
  ): AssetRow {
    const kind =
      (metadata?.mediaType ?? media.mediaType) === "video" ? "video" : "image";
    const sourceMetadata = parseJson(metadata?.sourceMetadataJSON ?? null) as
      | { width?: number; height?: number; alt?: string }
      | null;

    return this.finishAssetRow(
      {
        id: contentCid,
        kind,
        media_type: this.mediaTypeFor(metadata?.mimeType, kind, resolved),
        source_url: metadata?.sourceUrl ?? null,
        width: media.width ?? sourceMetadata?.width ?? null,
        height: media.height ?? sourceMetadata?.height ?? null,
        alt_text: media.alt ?? sourceMetadata?.alt ?? null,
      },
      resolved,
    );
  }

  private buildPreviewAssetRow(
    key: string,
    sourceUrl: string | null,
    resolved: ResolvedAsset | undefined,
  ): AssetRow {
    return this.finishAssetRow(
      {
        id: key,
        kind: "preview",
        media_type: this.mediaTypeFor(null, "image", resolved),
        source_url: sourceUrl,
        width: null,
        height: null,
        alt_text: null,
      },
      resolved,
    );
  }

  /**
   * What Cyd recorded, else what the bytes say, else what the kind implies.
   */
  private mediaTypeFor(
    stored: string | null | undefined,
    kind: "image" | "video",
    resolved: ResolvedAsset | undefined,
  ): string {
    if (stored) {
      return stored;
    }
    if (resolved?.availability === "available" && resolved.sniffedMediaType) {
      return resolved.sniffedMediaType;
    }
    return kind === "video" ? "video/mp4" : "image/jpeg";
  }

  private finishAssetRow(
    common: Omit<
      AssetRow,
      "byte_count" | "sha256" | "archive_path" | "availability" | "unavailable_reason"
    >,
    resolved: ResolvedAsset | undefined,
  ): AssetRow {
    if (resolved?.availability === "available") {
      return {
        ...common,
        byte_count: resolved.byteCount,
        sha256: resolved.sha256,
        archive_path: resolved.archivePath,
        availability: "available",
        unavailable_reason: null,
      };
    }

    return {
      ...common,
      byte_count: null,
      sha256: null,
      archive_path: null,
      availability: resolved?.availability ?? "missing",
      unavailable_reason:
        resolved === undefined
          ? "Cyd has no record of preserving this file."
          : resolved.reason,
    };
  }

  private buildPortableSettings(): PortableSettingRow[] {
    return PORTABLE_SETTING_KEYS.filter(
      (key) => this.context.portableSettings[key] !== undefined,
    )
      .map((key) => ({
        key,
        value_json: JSON.stringify(this.context.portableSettings[key]),
      }))
      .sort(compareBy((row) => row.key));
  }

  /** Record that a subject was selected for saving, at most once per category. */
  private select(
    category: SelectionCategory,
    subjectId: string,
    selectedAt: string,
  ): void {
    const key = `${category}\u0000${subjectId}`;
    if (!this.selections.has(key)) {
      this.selections.set(key, {
        category,
        subject_id: subjectId,
        selected_at: selectedAt,
      });
    }
  }
}

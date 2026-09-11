import { BlueskyArchiveRestoreError } from "./errors";
import type { ReadableInterchangeDatabase } from "./ports";

/**
 * Reading a Cyd Bluesky archive's interchange database, and nothing else.
 *
 * This is the reading half of the version 2 adapter ADR 0002 describes, and it
 * is the mirror of `services/archive-export/mobile-snapshot.ts`: that one is
 * the only place that knows Mobile's private column names, and this one is the
 * only place that knows the contract's. Everything downstream works on these
 * row types, so a change to either schema lands in one file.
 *
 * Intake has already proved the package intact (#95). What it has not proved
 * is that `data.db` is a version 2 Bluesky interchange database at all, so
 * that is checked here before a single row is trusted.
 */

export type InterchangeArchive = {
  created_at: string;
  account_did: string;
  account_uuid: string;
  completeness: "complete" | "incomplete";
};

export type InterchangeIdentity = {
  did: string;
  current_profile_id: string;
};

export type InterchangeProfile = {
  id: string;
  did: string;
  handle: string | null;
  display_name: string | null;
  avatar_asset_id: string | null;
  banner_asset_id: string | null;
  captured_at: string;
};

export type InterchangeRecord = {
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

export type InterchangeSelectionCategory =
  | "posts"
  | "reposts"
  | "likes"
  | "bookmarks"
  | "chats";

export type InterchangeSelection = {
  category: InterchangeSelectionCategory;
  subject_id: string;
  selected_at: string;
};

export type InterchangeRecordSubject = {
  relationship_uri: string;
  subject_record_uri: string;
};

export type InterchangeRecordContext = {
  record_uri: string;
  kind: "reply_parent" | "quote" | "external";
  context_record_uri: string | null;
  context_profile_id: string | null;
  external_json: string | null;
};

export type InterchangeConversation = {
  id: string;
  rev: string | null;
  first_observed_at: string;
  observed_at: string;
  source_deleted_at: string | null;
};

export type InterchangeConversationMember = {
  conversation_id: string;
  profile_id: string;
};

export type InterchangeMessage = {
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

export type InterchangeRelationship = {
  uri: string;
  kind: "follow" | "block" | "mute";
  actor_did: string;
  subject_did: string;
  created_at: string | null;
  observed_at: string;
  source_deleted_at: string | null;
};

export type InterchangeAsset = {
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

export type InterchangeRecordAsset = {
  owner_type: "record" | "message" | "profile";
  owner_id: string;
  asset_id: string;
  role: "content" | "preview" | "thumbnail" | "avatar" | "banner";
  position: number;
};

export type InterchangePortableSetting = {
  key: string;
  value_json: string;
};

export type BlueskyInterchangeSnapshot = {
  archive: InterchangeArchive;
  identity: InterchangeIdentity;
  profiles: InterchangeProfile[];
  records: InterchangeRecord[];
  selections: InterchangeSelection[];
  recordSubjects: InterchangeRecordSubject[];
  recordContext: InterchangeRecordContext[];
  conversations: InterchangeConversation[];
  conversationMembers: InterchangeConversationMember[];
  messages: InterchangeMessage[];
  relationships: InterchangeRelationship[];
  assets: InterchangeAsset[];
  recordAssets: InterchangeRecordAsset[];
  portableSettings: InterchangePortableSetting[];
};

type ArchiveHeaderRow = InterchangeArchive & {
  format: string;
  platform: string;
  version: number;
};

/**
 * Read one archive's interchange database in full.
 *
 * Ordering is by stable identifier throughout, so restoring the same archive
 * twice inserts the same rows in the same order rather than leaving the result
 * to whatever order SQLite happened to return.
 */
export async function readBlueskyInterchange(
  database: ReadableInterchangeDatabase,
): Promise<BlueskyInterchangeSnapshot> {
  const read = async <T>(sql: string): Promise<T[]> => {
    try {
      return await database.all<T>(sql);
    } catch (error) {
      // A database that does not answer the contract's own queries is not a
      // version 2 interchange database, whatever its file header says.
      throw new BlueskyArchiveRestoreError(
        "unreadable-interchange",
        `Cyd could not read this archive's data: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const [header] = await read<ArchiveHeaderRow>(
    `SELECT format, platform, version, created_at, account_did, account_uuid, completeness
     FROM archive LIMIT 1;`,
  );
  requireSupportedArchive(header);

  return {
    archive: {
      created_at: header.created_at,
      account_did: header.account_did,
      account_uuid: header.account_uuid,
      completeness: header.completeness,
    },
    identity: await readIdentity(read),
    profiles: await read<InterchangeProfile>(
      `SELECT id, did, handle, display_name, avatar_asset_id, banner_asset_id, captured_at
       FROM profiles ORDER BY id;`,
    ),
    records: await read<InterchangeRecord>(
      `SELECT uri, cid, record_type, author_profile_id, indexed_at, created_at,
              first_observed_at, observed_at, source_deleted_at, text, facets_json,
              payload_json
       FROM records ORDER BY uri;`,
    ),
    selections: await read<InterchangeSelection>(
      `SELECT category, subject_id, selected_at
       FROM selections ORDER BY category, subject_id;`,
    ),
    recordSubjects: await read<InterchangeRecordSubject>(
      `SELECT relationship_uri, subject_record_uri
       FROM record_subjects ORDER BY relationship_uri;`,
    ),
    recordContext: await read<InterchangeRecordContext>(
      `SELECT record_uri, kind, context_record_uri, context_profile_id, external_json
       FROM record_context ORDER BY record_uri, kind;`,
    ),
    conversations: await read<InterchangeConversation>(
      `SELECT id, rev, first_observed_at, observed_at, source_deleted_at
       FROM conversations ORDER BY id;`,
    ),
    conversationMembers: await read<InterchangeConversationMember>(
      `SELECT conversation_id, profile_id
       FROM conversation_members ORDER BY conversation_id, profile_id;`,
    ),
    messages: await read<InterchangeMessage>(
      `SELECT id, conversation_id, sender_profile_id, sent_at, observed_at,
              source_deleted_at, text, facets_json, payload_json
       FROM messages ORDER BY conversation_id, sent_at, id;`,
    ),
    relationships: await read<InterchangeRelationship>(
      `SELECT uri, kind, actor_did, subject_did, created_at, observed_at, source_deleted_at
       FROM relationships ORDER BY uri;`,
    ),
    assets: await read<InterchangeAsset>(
      `SELECT id, kind, media_type, byte_count, sha256, archive_path, availability,
              unavailable_reason, source_url, width, height, alt_text
       FROM assets ORDER BY id;`,
    ),
    recordAssets: await read<InterchangeRecordAsset>(
      `SELECT owner_type, owner_id, asset_id, role, position
       FROM record_assets ORDER BY owner_type, owner_id, role, position;`,
    ),
    portableSettings: await read<InterchangePortableSetting>(
      `SELECT key, value_json FROM portable_settings ORDER BY key;`,
    ),
  };
}

function requireSupportedArchive(header: ArchiveHeaderRow | undefined): void {
  if (!header) {
    throw new BlueskyArchiveRestoreError(
      "unsupported-interchange",
      "This archive's data does not say which account or format it holds.",
    );
  }
  if (header.format !== "cyd-archive" || header.platform !== "bluesky") {
    throw new BlueskyArchiveRestoreError(
      "unsupported-interchange",
      "This is not a Cyd Bluesky archive.",
    );
  }
  if (header.version !== 2) {
    throw new BlueskyArchiveRestoreError(
      "unsupported-interchange",
      `This archive is version ${header.version}, which this version of Cyd cannot restore.`,
    );
  }
  if (!header.account_did) {
    throw new BlueskyArchiveRestoreError(
      "unsupported-interchange",
      "This archive does not name the Bluesky identity it belongs to.",
    );
  }
}

async function readIdentity(
  read: <T>(sql: string) => Promise<T[]>,
): Promise<InterchangeIdentity> {
  const [identity] = await read<InterchangeIdentity>(
    `SELECT did, current_profile_id FROM identity LIMIT 1;`,
  );
  if (!identity) {
    throw new BlueskyArchiveRestoreError(
      "unsupported-interchange",
      "This archive does not name the Bluesky identity it belongs to.",
    );
  }
  return identity;
}

type ArchiveRow = Record<string, unknown>;

export type BlueskyArchiveTables = {
  archive: ArchiveRow[];
  identity: ArchiveRow[];
  profiles: ArchiveRow[];
  records: ArchiveRow[];
  selections: ArchiveRow[];
  record_subjects: ArchiveRow[];
  record_context: ArchiveRow[];
  conversations: ArchiveRow[];
  conversation_members: ArchiveRow[];
  messages: ArchiveRow[];
  relationships: ArchiveRow[];
  record_assets: ArchiveRow[];
  portable_settings: ArchiveRow[];
  assets: ArchiveRow[];
};

const fields = (
  row: ArchiveRow,
  mapping: Record<string, string>,
): ArchiveRow =>
  Object.fromEntries(
    Object.entries(mapping).map(([normalized, source]) => [
      normalized,
      row[source],
    ]),
  );

function json(value: unknown): unknown {
  return value === null ? null : JSON.parse(value as string);
}

function mapRows(
  rows: ArchiveRow[],
  mapping: Record<string, string>,
): ArchiveRow[] {
  return rows.map((row) => fields(row, mapping));
}

export function normalizeBlueskyArchiveSemantics(tables: BlueskyArchiveTables) {
  const archive = tables.archive[0];
  const identity = tables.identity[0];

  return {
    commonSemantics: {
      archive: fields(archive, {
        createdAt: "created_at",
        accountDid: "account_did",
        accountUuid: "account_uuid",
      }),
      identity: fields(identity, {
        did: "did",
        currentProfileId: "current_profile_id",
      }),
      profiles: mapRows(tables.profiles, {
        id: "id",
        did: "did",
        handle: "handle",
        displayName: "display_name",
        description: "description",
        avatarAssetId: "avatar_asset_id",
        bannerAssetId: "banner_asset_id",
        capturedAt: "captured_at",
      }),
      records: tables.records.map((row) => ({
        ...fields(row, {
          uri: "uri",
          cid: "cid",
          recordType: "record_type",
          authorProfileId: "author_profile_id",
          indexedAt: "indexed_at",
          createdAt: "created_at",
          firstObservedAt: "first_observed_at",
          observedAt: "observed_at",
          sourceDeletedAt: "source_deleted_at",
          text: "text",
        }),
        facets: json(row.facets_json),
        payload: json(row.payload_json),
      })),
      selections: mapRows(tables.selections, {
        category: "category",
        subjectId: "subject_id",
        selectedAt: "selected_at",
      }),
      recordSubjects: mapRows(tables.record_subjects, {
        relationshipUri: "relationship_uri",
        subjectRecordUri: "subject_record_uri",
      }),
      recordContext: tables.record_context.map((row) => ({
        ...fields(row, {
          recordUri: "record_uri",
          kind: "kind",
          contextRecordUri: "context_record_uri",
          contextProfileId: "context_profile_id",
        }),
        external: json(row.external_json),
      })),
      conversations: mapRows(tables.conversations, {
        id: "id",
        rev: "rev",
        firstObservedAt: "first_observed_at",
        observedAt: "observed_at",
        sourceDeletedAt: "source_deleted_at",
      }),
      conversationMembers: mapRows(tables.conversation_members, {
        conversationId: "conversation_id",
        profileId: "profile_id",
      }),
      messages: tables.messages.map((row) => ({
        ...fields(row, {
          id: "id",
          conversationId: "conversation_id",
          senderProfileId: "sender_profile_id",
          sentAt: "sent_at",
          observedAt: "observed_at",
          sourceDeletedAt: "source_deleted_at",
          text: "text",
        }),
        facets: json(row.facets_json),
        payload: json(row.payload_json),
      })),
      relationships: mapRows(tables.relationships, {
        uri: "uri",
        kind: "kind",
        actorDid: "actor_did",
        subjectDid: "subject_did",
        createdAt: "created_at",
        observedAt: "observed_at",
        sourceDeletedAt: "source_deleted_at",
      }),
      recordAssets: mapRows(tables.record_assets, {
        ownerType: "owner_type",
        ownerId: "owner_id",
        assetId: "asset_id",
        role: "role",
        position: "position",
      }),
      portableSettings: tables.portable_settings.map((row) => ({
        key: row.key,
        value: json(row.value_json),
      })),
    },
    assets: mapRows(tables.assets, {
      id: "id",
      kind: "kind",
      mediaType: "media_type",
      byteCount: "byte_count",
      sha256: "sha256",
      archivePath: "archive_path",
      availability: "availability",
      unavailableReason: "unavailable_reason",
      sourceUrl: "source_url",
      width: "width",
      height: "height",
      altText: "alt_text",
    }),
    completeness: archive.completeness,
  };
}

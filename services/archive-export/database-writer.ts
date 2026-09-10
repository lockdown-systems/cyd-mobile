import type { BlueskyInterchangeContent } from "./interchange";
import type { WritableDatabase } from "./ports";
import { BLUESKY_ARCHIVE_V2_SCHEMA_SQL } from "./schema";

/**
 * Writing the translated account into a Cyd Bluesky archive's `data.db`.
 *
 * The insert order is the foreign-key order, not an arbitrary one: SQLite
 * enforces references as each row lands, so assets precede the profiles that
 * point at them, profiles precede records, and so on. Leaving foreign keys on
 * while writing is deliberate — it means a translation bug fails here, while
 * the archive is still a staged working file, instead of at import time on
 * somebody else's device.
 */
export function writeBlueskyInterchangeDatabase(
  database: WritableDatabase,
  content: BlueskyInterchangeContent,
): void {
  database.exec(BLUESKY_ARCHIVE_V2_SCHEMA_SQL);

  insert(database, "assets", content.assets);
  insert(database, "profiles", content.profiles);
  insert(database, "records", content.records);
  insert(database, "selections", content.selections);
  insert(database, "record_subjects", content.recordSubjects);
  insert(database, "record_context", content.recordContext);
  insert(database, "conversations", content.conversations);
  insert(database, "conversation_members", content.conversationMembers);
  insert(database, "messages", content.messages);
  insert(database, "relationships", content.relationships);
  insert(database, "record_assets", content.recordAssets);
  insert(database, "portable_settings", content.portableSettings);
  insert(database, "identity", [content.identity]);
  insert(database, "archive", [content.archive]);
}

function insert(
  database: WritableDatabase,
  table: string,
  rows: Record<string, unknown>[],
): void {
  for (const row of rows) {
    const columns = Object.keys(row);
    database.run(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns
        .map(() => "?")
        .join(", ")});`,
      columns.map((column) => row[column]),
    );
  }
}

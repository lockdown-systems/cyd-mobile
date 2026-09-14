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

  // One transaction around the lot, rather than one per row. Outside a
  // transaction SQLite commits after every statement and waits for the storage
  // to say so, which on a phone is most of a minute for an account's worth of
  // records — the export is not thinking, it is waiting on fsync. Foreign keys
  // are still checked as each row lands, so the reference order above is doing
  // exactly what it did before.
  database.exec("BEGIN");
  try {
    insertAll(database, content);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function insertAll(
  database: WritableDatabase,
  content: BlueskyInterchangeContent,
): void {
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

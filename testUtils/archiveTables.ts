import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { unzipSync } from "fflate";

import type { BlueskyArchiveTables } from "@/services/archive-semantics";

/**
 * Reading a Cyd Bluesky archive's interchange tables in a test.
 *
 * `scripts/archive-contract/test_bundle.py` does the same thing in Python, to
 * feed the pinned bundle's fixtures into Mobile's normalizer. This is that
 * reader for archives no bundle publishes — the ones Mobile's own writer
 * produced during a test — so both sides of a round trip can be normalized
 * and compared the same way.
 *
 * It reads whole entries into memory, which is fine for fixtures and would not
 * be fine on a phone. Nothing here is app code.
 */

export function unzipArchive(archive: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(archive);
}

/** The interchange tables, in the row order the canonical expectations use. */
const TABLE_QUERIES = {
  archive: "SELECT * FROM archive",
  identity: "SELECT * FROM identity",
  profiles: "SELECT * FROM profiles ORDER BY id",
  records: "SELECT * FROM records ORDER BY uri",
  selections: "SELECT * FROM selections ORDER BY category",
  record_subjects: "SELECT * FROM record_subjects ORDER BY relationship_uri",
  record_context: "SELECT * FROM record_context ORDER BY record_uri, kind",
  conversations: "SELECT * FROM conversations ORDER BY id",
  conversation_members:
    "SELECT * FROM conversation_members ORDER BY conversation_id, profile_id",
  messages: "SELECT * FROM messages ORDER BY id",
  relationships: "SELECT * FROM relationships ORDER BY uri",
  record_assets:
    "SELECT * FROM record_assets ORDER BY owner_type, owner_id, role, position",
  portable_settings: "SELECT * FROM portable_settings ORDER BY key",
  assets: "SELECT * FROM assets ORDER BY id",
} as const satisfies Record<keyof BlueskyArchiveTables, string>;

/** Every interchange table out of an archive's `data.db`. */
export function readArchiveTables(interchange: Uint8Array): BlueskyArchiveTables {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cyd-interchange-"));
  const location = path.join(directory, "data.db");
  fs.writeFileSync(location, interchange);
  const database = new DatabaseSync(location, { readOnly: true });
  try {
    return Object.fromEntries(
      Object.entries(TABLE_QUERIES).map(([table, query]) => [
        table,
        database.prepare(query).all() as Record<string, unknown>[],
      ]),
    ) as BlueskyArchiveTables;
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

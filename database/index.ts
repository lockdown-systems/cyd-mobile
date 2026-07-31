import {
  defaultDatabaseDirectory,
  openDatabaseAsync,
  type SQLiteDatabase,
} from "expo-sqlite";

import { migrateLegacyBlueskyConnections } from "./connection-migration";
import { migrations } from "./migrations";

const CONNECTION_STORAGE_MIGRATION_VERSION = 6;

/**
 * Get the parent directory of the default SQLite database directory.
 * expo-sqlite defaults to `<files>/SQLite/`. We store main.db one level up
 * in `<files>/` so it lives alongside the accounts directory.
 */
function getMainDatabaseDirectory(): string {
  const dir = defaultDatabaseDirectory as string;
  const lastSlash = dir.replace(/\/+$/, "").lastIndexOf("/");
  return lastSlash > 0 ? dir.substring(0, lastSlash) : dir;
}

let databasePromise: Promise<SQLiteDatabase> | null = null;

export async function getDatabase(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = openAndMigrate();
  }

  return databasePromise;
}

async function openAndMigrate(): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync("main.db", {}, getMainDatabaseDirectory());
  await db.execAsync("PRAGMA foreign_keys = ON;");
  const currentVersion = await getSchemaVersion(db);
  if (
    currentVersion > 0 &&
    currentVersion < CONNECTION_STORAGE_MIGRATION_VERSION
  ) {
    await migrateLegacyBlueskyConnections(db);
  }
  await applyPendingMigrations(db, currentVersion);
  return db;
}

async function getSchemaVersion(db: SQLiteDatabase): Promise<number> {
  const versionRow = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version;",
  );
  return versionRow?.user_version ?? 0;
}

async function applyPendingMigrations(
  db: SQLiteDatabase,
  currentVersion: number,
) {

  const pending = migrations
    .filter((migration) => migration.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    await db.withTransactionAsync(async () => {
      for (const statement of migration.statements) {
        await db.execAsync(statement);
      }
      await db.execAsync(`PRAGMA user_version = ${migration.version};`);
    });
  }
}

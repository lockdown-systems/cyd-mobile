import { Directory, File, FileMode } from "expo-file-system";
import {
  defaultDatabaseDirectory,
  openDatabaseAsync,
  type SQLiteDatabase,
} from "expo-sqlite";

import { buildAccountPaths } from "@/controllers/BaseAccountController";
import {
  applyAccountMigrations,
  blueskyAccountMigrations,
} from "@/database/account-db";
import {
  createBlueskyAccount,
  deleteAccount,
  listAccounts,
} from "@/database/accounts";
import { getDatabase } from "@/database";
import { stagedPayloadPath } from "@/services/archive-import";
import { requireStagedFilePath } from "@/services/archive-import/entry-paths";
import { ARCHIVE_STAGING_DIRECTORY } from "@/services/device-storage";

import type { LocalAccountIdentity } from "./identity";
import type {
  BlueskyArchiveRestoreEnvironment,
  PreparedArchiveLocation,
  PreparedArchiveStore,
  ReadableInterchangeDatabase,
  RestoredAccountDatabase,
  StoredMediaFile,
} from "./ports";

/**
 * The device-backed implementation of the restore ports.
 *
 * Everything platform-specific about turning a prepared Cyd Bluesky archive
 * into a Bluesky local account lives here: SQLite handles, file handles, and
 * Cyd's own account tables. The restore logic never sees any of it, which is
 * what lets the committed fixtures be restored and browsed under Node.
 */

/** How much of a staged payload to move at a time. */
const COPY_CHUNK_BYTES = 256 * 1024;

/**
 * expo-sqlite wants a plain directory path, while the file APIs want a
 * `file://` URI. Intake staging exists in both forms, the same way export
 * staging does.
 */
function nativeStagingRoot(): string {
  const sqliteDirectory = (defaultDatabaseDirectory as string).replace(/\/+$/, "");
  const parent = sqliteDirectory.slice(0, sqliteDirectory.lastIndexOf("/"));
  return `${parent}/${ARCHIVE_STAGING_DIRECTORY}`;
}

function asReadableInterchange(
  database: SQLiteDatabase,
): ReadableInterchangeDatabase {
  return {
    all: async <T>(sql: string) => database.getAllAsync<T>(sql),
    close: async () => database.closeAsync(),
  };
}

function asRestoredAccountDatabase(
  database: SQLiteDatabase,
): RestoredAccountDatabase {
  return {
    run: async (sql, params) => {
      await database.runAsync(sql, params as never[]);
    },
    transaction: (work) => database.withTransactionAsync(work),
    close: async () => database.closeAsync(),
  };
}

async function openAccountDatabase(accountUuid: string): Promise<SQLiteDatabase> {
  const paths = buildAccountPaths("bluesky", accountUuid);
  new Directory(paths.accountDir).create({
    intermediates: true,
    idempotent: true,
  });
  const database = await openDatabaseAsync(
    paths.dbNameForSQLite,
    {},
    paths.dbDirForSQLite,
  );
  await database.execAsync("PRAGMA foreign_keys = ON;");
  applyAccountMigrations(database, blueskyAccountMigrations);
  return database;
}

function openPreparedArchive(
  archive: PreparedArchiveLocation,
): PreparedArchiveStore {
  const nativeRoot = `${nativeStagingRoot()}/${archive.intakeId}`;
  return {
    discard: async () => {
      const staging = new Directory(archive.stagingRoot);
      if (staging.exists) {
        staging.delete();
      }
    },

    openInterchange: async () => {
      const staged = stagedPayloadPath("data.db");
      const separator = staged.lastIndexOf("/");
      return asReadableInterchange(
        await openDatabaseAsync(
          staged.slice(separator + 1),
          {},
          `${nativeRoot}/${staged.slice(0, separator)}`,
        ),
      );
    },

    readPayload: async (archivePath, onBytes) => {
      const file = new File(
        `${archive.stagingRoot}${requireStagedFilePath(stagedPayloadPath(archivePath))}`,
      );
      const handle = file.open(FileMode.ReadOnly);
      try {
        const total = handle.size ?? file.size ?? 0;
        let offset = 0;
        while (offset < total) {
          handle.offset = offset;
          const chunk = handle.readBytes(
            Math.min(COPY_CHUNK_BYTES, total - offset),
          );
          if (chunk.length === 0) {
            break;
          }
          onBytes(chunk);
          offset += chunk.length;
        }
      } finally {
        handle.close();
      }
    },
  };
}

export function createBlueskyArchiveRestoreEnvironment(): BlueskyArchiveRestoreEnvironment {
  return {
    openPreparedArchive,

    listLocalAccountIdentities: async (): Promise<LocalAccountIdentity[]> =>
      (await listAccounts()).map((account) => ({
        uuid: account.uuid,
        did: account.did,
        handle: account.handle,
      })),

    createLocalAccount: async (request) => {
      const account = await createBlueskyAccount({
        uuid: request.uuid,
        did: request.did,
        handle: request.handle,
        displayName: request.displayName,
        avatarUrl: request.avatarUrl,
      });

      // Portable settings apply only to an account being created, so they are
      // written here rather than through the settings screens' own updates,
      // which exist to record a choice somebody just made (ADR 0015).
      const columns = Object.keys(request.settings);
      if (columns.length > 0) {
        const main = await getDatabase();
        await main.runAsync(
          `UPDATE bsky_account
           SET ${columns.map((column) => `${column} = ?`).join(", ")}
           WHERE id = (SELECT bskyAccountID FROM account WHERE id = ?);`,
          [...columns.map((column) => request.settings[column]), account.id],
        );
      }

      // Creating the database here means a restore that fails later leaves an
      // account directory to delete rather than a half-migrated one to guess at.
      (await openAccountDatabase(request.uuid)).closeSync();

      return { accountId: account.id, accountUuid: account.uuid };
    },

    openAccountDatabase: async (accountUuid) =>
      asRestoredAccountDatabase(await openAccountDatabase(accountUuid)),

    storeAccountMedia: async (
      accountUuid,
      fileName,
      write,
    ): Promise<StoredMediaFile> => {
      const paths = buildAccountPaths("bluesky", accountUuid);
      new Directory(paths.mediaDir).create({
        intermediates: true,
        idempotent: true,
      });

      const file = new File(`${paths.mediaDir}${fileName}`);
      file.create({ intermediates: true, overwrite: true });
      const handle = file.open(FileMode.Truncate);
      let byteLength = 0;
      try {
        await write((bytes) => {
          handle.writeBytes(bytes);
          byteLength += bytes.length;
        });
      } finally {
        handle.close();
      }
      return { uri: file.uri, byteLength };
    },

    discardLocalAccount: async (account) => {
      if (account.accountId !== null) {
        await deleteAccount(account.accountId);
      }
      const directory = new Directory(
        buildAccountPaths("bluesky", account.accountUuid).accountDir,
      );
      if (directory.exists) {
        directory.delete();
      }
    },

    newUuid: () => {
      const generated = globalThis.crypto?.randomUUID?.();
      if (generated) {
        return generated;
      }
      throw new Error("This device cannot generate a local-account identifier");
    },

    now: () => new Date(),
  };
}

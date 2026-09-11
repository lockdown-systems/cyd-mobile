import { Directory, File } from "expo-file-system";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import { buildAccountPaths } from "@/controllers/BaseAccountController";
import {
  applyAccountMigrations,
  blueskyAccountMigrations,
} from "@/database/account-db";
import { deleteAccount, listAccounts } from "@/database/accounts";
import { getDatabase } from "@/database";
import { openPreparedArchive } from "@/services/archive-restore/environment";
import type { LocalAccountIdentity } from "@/services/archive-restore";

import {
  RECONCILABLE_SETTING_COLUMNS,
  type BlueskyArchiveMergeEnvironment,
  type MergeableAccountDatabase,
  type ReconcilableAccountSettings,
  type ReconcilableSettingColumn,
} from "./ports";

/**
 * The device-backed implementation of the merge ports.
 *
 * It is the restore adapter's neighbour and shares its staging reader: the
 * difference between the two halves of an import is which account the rows go
 * into, not how an archive is read. Everything else here is the same three
 * things a phone does differently — SQLite, files, and Cyd's own account
 * tables — so the merge logic never sees any of them.
 */

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

function asMergeableAccountDatabase(
  database: SQLiteDatabase,
): MergeableAccountDatabase {
  return {
    all: async <T>(sql: string) => database.getAllAsync<T>(sql),
    run: async (sql, params) => {
      await database.runAsync(sql, params as never[]);
    },
    transaction: (work) => database.withTransactionAsync(work),
    close: async () => database.closeAsync(),
  };
}

function mediaUri(accountUuid: string, fileName: string): string {
  return `${buildAccountPaths("bluesky", accountUuid).mediaDir}${fileName}`;
}

export function createBlueskyArchiveMergeEnvironment(): BlueskyArchiveMergeEnvironment {
  return {
    openPreparedArchive,

    listLocalAccountIdentities: async (): Promise<LocalAccountIdentity[]> =>
      (await listAccounts()).map((account) => ({
        uuid: account.uuid,
        did: account.did,
        handle: account.handle,
      })),

    openAccountDatabase: async (accountUuid) =>
      asMergeableAccountDatabase(await openAccountDatabase(accountUuid)),

    storeAccountMedia: async (accountUuid, fileName, write) => {
      const paths = buildAccountPaths("bluesky", accountUuid);
      new Directory(paths.mediaDir).create({
        intermediates: true,
        idempotent: true,
      });

      const file = new File(mediaUri(accountUuid, fileName));
      file.create({ intermediates: true, overwrite: true });
      const handle = file.open();
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

    accountMediaUri: mediaUri,

    readAccountSettings: async (accountUuid) => {
      const main = await getDatabase();
      const row = await main.getFirstAsync<ReconcilableAccountSettings>(
        `SELECT ${RECONCILABLE_SETTING_COLUMNS.join(", ")}
         FROM bsky_account b
         INNER JOIN account a ON a.bskyAccountID = b.id
         WHERE a.uuid = ?;`,
        [accountUuid],
      );
      return row ?? {};
    },

    applyAccountSettings: async (accountUuid, settings) => {
      const entries = Object.entries(settings) as [
        ReconcilableSettingColumn,
        string | number | null,
      ][];
      if (entries.length === 0) {
        return;
      }
      const main = await getDatabase();
      await main.runAsync(
        `UPDATE bsky_account
         SET ${entries.map(([column]) => `${column} = ?`).join(", ")}
         WHERE id = (SELECT bskyAccountID FROM account WHERE uuid = ?);`,
        [...entries.map(([, value]) => value), accountUuid],
      );
    },

    adoptAccountMedia: async (_sourceAccountUuid, targetAccountUuid, localPath) => {
      const source = new File(localPath);
      if (!source.exists) {
        return null;
      }
      const paths = buildAccountPaths("bluesky", targetAccountUuid);
      new Directory(paths.mediaDir).create({
        intermediates: true,
        idempotent: true,
      });
      const destination = new File(mediaUri(targetAccountUuid, source.name));
      if (!destination.exists) {
        await source.copy(destination);
      }
      return { uri: destination.uri, byteLength: destination.size ?? 0 };
    },

    enforceOneAccountPerDid: async () => {
      const main = await getDatabase();
      await main.execAsync(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_bsky_account_did
         ON bsky_account(did);`,
      );
    },

    removeLocalAccount: async (account) => {
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

    now: () => new Date(),
  };
}

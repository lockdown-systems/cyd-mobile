import { Directory, File } from "expo-file-system";
import type { SQLiteDatabase } from "expo-sqlite";

import { buildAccountPaths } from "@/controllers/BaseAccountController";
import {
  applyAccountMigrations,
  blueskyAccountMigrations,
} from "@/database/account-db";
import {
  acquireAccountDatabase,
  releaseAccountDatabase,
} from "@/database/account-db/shared-handles";
import { listAccounts } from "@/database/accounts";
import { openPreparedArchive } from "@/services/archive-restore/environment";
import type { LocalAccountIdentity } from "@/services/archive-restore";

import type {
  BlueskyArchiveMergeEnvironment,
  MergeableAccountDatabase,
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
  // Borrowed rather than opened: the app may already hold this database, and a
  // second handle over the same connection closes it for the first one when it
  // is collected.
  const database = await acquireAccountDatabase(
    paths.dbDirForSQLite,
    paths.dbNameForSQLite,
  );
  applyAccountMigrations(database, blueskyAccountMigrations);
  return database;
}

function asMergeableAccountDatabase(
  database: SQLiteDatabase,
  accountUuid: string,
): MergeableAccountDatabase {
  const paths = buildAccountPaths("bluesky", accountUuid);
  return {
    all: async <T>(sql: string) => database.getAllAsync<T>(sql),
    run: async (sql, params) => {
      await database.runAsync(sql, params as never[]);
    },
    transaction: (work) => database.withTransactionAsync(work),
    // Handed back rather than closed. The account screen may be holding this
    // very database, and closing a borrowed handle closes it for them too.
    close: async () =>
      releaseAccountDatabase(paths.dbDirForSQLite, paths.dbNameForSQLite),
  };
}

/**
 * Where a media file lives, in the exact form storing it reports back.
 *
 * A merge previews the rows it would write before it copies any bytes, so the
 * predicted path has to be the one `storeAccountMedia` ends up returning —
 * otherwise every import would look like it had media to update. Going through
 * `File` is what guarantees they agree: the same normalization on both sides.
 */
function mediaUri(accountUuid: string, fileName: string): string {
  return new File(
    `${buildAccountPaths("bluesky", accountUuid).mediaDir}${fileName}`,
  ).uri;
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
      asMergeableAccountDatabase(
        await openAccountDatabase(accountUuid),
        accountUuid,
      ),

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
  };
}

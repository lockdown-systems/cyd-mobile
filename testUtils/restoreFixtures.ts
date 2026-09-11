/**
 * The Cyd Bluesky archive restore ports, backed by Node instead of a phone.
 *
 * A restored Bluesky local account is only worth anything if Mobile's own
 * browse screens can read it, so these adapters build the real thing: a
 * `main.db` carrying Mobile's own migrations, per-account databases carrying
 * the Bluesky account migrations, and media as files on disk. Only the four
 * things a phone does differently — SQLite, files, UUIDs, and the clock — are
 * supplied from here.
 *
 * The intake environment beside it stages an archive on disk rather than in
 * memory, which is what lets a test run intake and restore back to back the
 * way the app does.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  applyAccountMigrations,
  blueskyAccountMigrations,
} from "@/database/account-db";
import { migrations } from "@/database/migrations";
import { createInflateDecompressor } from "@/services/archive-import/inflate";
import type {
  BlueskyArchiveIntakeEnvironment,
  BlueskyArchiveStagingArea,
  Hasher,
  StagedFileWriter,
} from "@/services/archive-import/ports";
import { stagedPayloadPath } from "@/services/archive-import";
import type {
  BlueskyArchiveRestoreEnvironment,
  DiscardableAccount,
  NewLocalAccountRequest,
  PreparedArchiveStore,
  ReadableInterchangeDatabase,
  RestoredAccountDatabase,
} from "@/services/archive-restore";
import type { LocalAccountIdentity } from "@/services/archive-restore";

const createNodeHasher = (): Hasher => {
  const hash = crypto.createHash("sha256");
  return {
    update: (chunk: Uint8Array) => {
      hash.update(chunk);
    },
    digestHex: () => hash.digest("hex"),
  };
};

class DiskStagingArea implements BlueskyArchiveStagingArea {
  readonly root: string;
  destroyed = false;

  constructor(root: string) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
  }

  private locate(relativePath: string): string {
    return path.join(this.root, relativePath);
  }

  createFile(relativePath: string): StagedFileWriter {
    const location = this.locate(relativePath);
    fs.mkdirSync(path.dirname(location), { recursive: true });
    const handle = fs.openSync(location, "w");
    return {
      write: (chunk) => {
        fs.writeSync(handle, chunk);
      },
      close: () => fs.closeSync(handle),
    };
  }

  fileExists(relativePath: string): boolean {
    return fs.existsSync(this.locate(relativePath));
  }

  fileSize(relativePath: string): number | null {
    const location = this.locate(relativePath);
    return fs.existsSync(location) ? fs.statSync(location).size : null;
  }

  readText(relativePath: string): string | null {
    const location = this.locate(relativePath);
    return fs.existsSync(location) ? fs.readFileSync(location, "utf8") : null;
  }

  writeText(relativePath: string, contents: string): void {
    const location = this.locate(relativePath);
    fs.mkdirSync(path.dirname(location), { recursive: true });
    fs.writeFileSync(location, contents);
  }

  destroy(): void {
    this.destroyed = true;
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}

/** Intake that stages onto a real filesystem, so a restore can read it back. */
export function createDiskBlueskyArchiveIntakeEnvironment(
  stagingParent: string,
): BlueskyArchiveIntakeEnvironment {
  return {
    openStaging: (intakeId) =>
      new DiskStagingArea(path.join(stagingParent, intakeId)),
    listStagingIds: () =>
      fs.existsSync(stagingParent) ? fs.readdirSync(stagingParent) : [],
    availableStorageBytes: () => 8 * 1024 * 1024 * 1024,
    createHasher: createNodeHasher,
    createDecompressor: createInflateDecompressor,
    now: () => new Date("2026-09-12T00:00:00.000Z"),
  };
}

function asReadableInterchange(
  database: DatabaseSync,
): ReadableInterchangeDatabase {
  return {
    all: async <T>(sql: string): Promise<T[]> =>
      database.prepare(sql).all() as T[],
    close: async () => database.close(),
  };
}

function asRestoredAccountDatabase(
  database: DatabaseSync,
): RestoredAccountDatabase {
  return {
    run: async (sql, params) => {
      database.prepare(sql).run(...(params as never[]));
    },
    transaction: async (work) => {
      database.exec("BEGIN;");
      try {
        await work();
        database.exec("COMMIT;");
      } catch (error) {
        database.exec("ROLLBACK;");
        throw error;
      }
    },
    close: async () => database.close(),
  };
}

export type NodeRestoreEnvironment = BlueskyArchiveRestoreEnvironment & {
  /** Mobile's own `main.db`, for asserting what a restore created. */
  mainDatabase: DatabaseSync;
  accountDirectory(accountUuid: string): string;
  openRestoredAccountDatabase(accountUuid: string): DatabaseSync;
  close(): void;
};

export type NodeRestoreEnvironmentOptions = {
  /** A directory standing in for the app's private storage. */
  root: string;
  newUuid?: () => string;
  now?: () => Date;
};

export function createNodeBlueskyArchiveRestoreEnvironment(
  options: NodeRestoreEnvironmentOptions,
): NodeRestoreEnvironment {
  fs.mkdirSync(options.root, { recursive: true });
  const mainDatabase = new DatabaseSync(path.join(options.root, "main.db"));
  for (const migration of migrations) {
    for (const statement of migration.statements) {
      mainDatabase.exec(statement);
    }
  }

  const accountDirectory = (accountUuid: string): string =>
    path.join(options.root, "accounts", `bluesky-${accountUuid}`);

  const openAccount = (accountUuid: string): DatabaseSync => {
    const directory = accountDirectory(accountUuid);
    fs.mkdirSync(directory, { recursive: true });
    const database = new DatabaseSync(path.join(directory, "data.db"));
    database.exec("PRAGMA foreign_keys = ON;");
    applyAccountMigrations(
      {
        getFirstSync: <T>(sql: string) => database.prepare(sql).get() as T,
        execSync: (sql: string) => database.exec(sql),
        withTransactionSync: (fn: () => void) => {
          database.exec("BEGIN;");
          try {
            fn();
            database.exec("COMMIT;");
          } catch (error) {
            database.exec("ROLLBACK;");
            throw error;
          }
        },
      },
      blueskyAccountMigrations,
    );
    return database;
  };

  let generated = 0;

  return {
    mainDatabase,
    accountDirectory,
    openRestoredAccountDatabase: openAccount,
    close: () => mainDatabase.close(),

    openPreparedArchive({ stagingRoot }): PreparedArchiveStore {
      const locate = (archivePath: string): string =>
        path.join(stagingRoot, stagedPayloadPath(archivePath));
      return {
        openInterchange: async () =>
          asReadableInterchange(
            new DatabaseSync(locate("data.db"), { readOnly: true }),
          ),
        readPayload: async (archivePath, onBytes) => {
          onBytes(new Uint8Array(fs.readFileSync(locate(archivePath))));
        },
        discard: async () => {
          fs.rmSync(stagingRoot, { recursive: true, force: true });
        },
      };
    },

    listLocalAccountIdentities: async (): Promise<LocalAccountIdentity[]> =>
      mainDatabase
        .prepare(
          `SELECT a.uuid, b.did, b.handle
           FROM account a
           INNER JOIN bsky_account b ON b.id = a.bskyAccountID;`,
        )
        .all() as LocalAccountIdentity[],

    createLocalAccount: async (request: NewLocalAccountRequest) => {
      const now = Date.now();
      const settingColumns = Object.keys(request.settings);
      const insert = mainDatabase
        .prepare(
          `INSERT INTO bsky_account (
             createdAt, updatedAt, accessedAt, handle, displayName, postsCount,
             avatarUrl, did${settingColumns.map((column) => `, ${column}`).join("")}
           ) VALUES (?, ?, ?, ?, ?, 0, ?, ?${settingColumns.map(() => ", ?").join("")});`,
        )
        .run(
          now,
          now,
          now,
          request.handle,
          request.displayName,
          request.avatarUrl,
          request.did,
          ...settingColumns.map((column) => request.settings[column]),
        );
      const sortOrder = (
        mainDatabase
          .prepare(
            "SELECT COALESCE(MAX(sortOrder), -1) + 1 AS nextOrder FROM account;",
          )
          .get() as { nextOrder: number }
      ).nextOrder;
      const account = mainDatabase
        .prepare(
          `INSERT INTO account (uuid, sortOrder, type, bskyAccountID)
           VALUES (?, ?, 'bluesky', ?);`,
        )
        .run(request.uuid, sortOrder, Number(insert.lastInsertRowid));

      fs.mkdirSync(accountDirectory(request.uuid), { recursive: true });
      openAccount(request.uuid).close();

      return {
        accountId: Number(account.lastInsertRowid),
        accountUuid: request.uuid,
      };
    },

    openAccountDatabase: async (accountUuid) =>
      asRestoredAccountDatabase(openAccount(accountUuid)),

    storeAccountMedia: async (accountUuid, fileName, write) => {
      const directory = path.join(accountDirectory(accountUuid), "media");
      fs.mkdirSync(directory, { recursive: true });
      const location = path.join(directory, fileName);
      const chunks: Uint8Array[] = [];
      await write((bytes) => chunks.push(bytes.slice()));
      const contents = Buffer.concat(chunks);
      fs.writeFileSync(location, contents);
      return { uri: `file://${location}`, byteLength: contents.byteLength };
    },

    discardLocalAccount: async (account: DiscardableAccount) => {
      if (account.accountId !== null) {
        const row = mainDatabase
          .prepare("SELECT bskyAccountID FROM account WHERE id = ?;")
          .get(account.accountId) as { bskyAccountID: number } | undefined;
        mainDatabase
          .prepare("DELETE FROM account WHERE id = ?;")
          .run(account.accountId);
        if (row) {
          mainDatabase
            .prepare("DELETE FROM bsky_account WHERE id = ?;")
            .run(row.bskyAccountID);
        }
      }
      fs.rmSync(accountDirectory(account.accountUuid), {
        recursive: true,
        force: true,
      });
    },

    newUuid: options.newUuid ?? (() => `generated-uuid-${(generated += 1)}`),
    now: options.now ?? (() => new Date("2026-09-12T00:00:00.000Z")),
  };
}

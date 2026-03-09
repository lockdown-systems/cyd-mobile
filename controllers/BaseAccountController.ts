import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import {
  defaultDatabaseDirectory,
  openDatabaseAsync,
  type SQLiteDatabase,
} from "expo-sqlite";

import { getDatabase } from "@/database";

function getDocumentsBasePath(): string {
  const baseDir = Paths.document ?? Paths.cache;
  if (!baseDir?.uri) {
    throw new Error("Unable to resolve a writable document directory");
  }
  const uri = baseDir.uri;
  return uri.endsWith("/") ? uri : `${uri}/`;
}

/**
 * Get the parent directory of the default SQLite database directory.
 * expo-sqlite defaults to `<files>/SQLite/`. Account databases live under
 * `<files>/accounts/<type>-<uuid>/` so we need the parent path.
 */
function getSQLiteParentDirectory(): string {
  const dir = defaultDatabaseDirectory as string;
  const lastSlash = dir.replace(/\/+$/, "").lastIndexOf("/");
  return lastSlash > 0 ? dir.substring(0, lastSlash) : dir;
}

export function buildAccountPaths(accountType: string, accountUUID: string) {
  const base = getDocumentsBasePath();
  const accountsDir = `${base}accounts/`;
  const accountDir = `${accountsDir}${accountType}-${accountUUID}/`;
  const sqliteParent = getSQLiteParentDirectory();
  return {
    base,
    accountsDir,
    accountDir,
    dbPath: `${accountDir}data.db`,
    // Directory for openDatabaseAsync so it writes to <files>/accounts/... instead of <files>/SQLite/
    dbDirForSQLite: `${sqliteParent}/accounts/${accountType}-${accountUUID}`,
    dbNameForSQLite: "data.db",
    mediaDir: `${accountDir}media/`,
    metadataPath: `${accountDir}metadata.json`,
  } as const;
}

async function ensureDirectoryExists(path: string): Promise<void> {
  const info = Paths.info(path);
  if (info.exists && info.isDirectory) {
    return;
  }
  if (info.exists && !info.isDirectory) {
    throw new Error(`Expected directory at ${path} but found a file`);
  }
  const dir = new Directory(path);
  dir.create({ intermediates: true, idempotent: true });
}

/**
 * Abstract base class for account controllers.
 * Provides common functionality for managing per-account databases,
 * configuration storage, and progress tracking.
 */
export abstract class BaseAccountController<TProgress = unknown> {
  private static sharedAccountDbs = new Map<
    string,
    { db: SQLiteDatabase; refCount: number }
  >();

  protected accountId: number;
  protected accountUUID: string;
  protected db: SQLiteDatabase | null = null;
  private sharedDbKey: string | null = null;
  private _disposed = false;
  protected _progress: TProgress;
  private paused = false;
  private pauseResolvers: (() => void)[] = [];
  private pauseListeners: ((paused: boolean) => void)[] = [];

  constructor(accountId: number, accountUUID?: string) {
    this.accountId = accountId;
    // If UUID not provided, generate one (will be overwritten when fetched from DB)
    this.accountUUID = accountUUID ?? Crypto.randomUUID();
    this._progress = this.resetProgress();
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Get the account type identifier (e.g., 'bluesky')
   */
  abstract getAccountType(): string;

  /**
   * Initialize the account-specific database with migrations
   */
  abstract initDB(): Promise<void>;

  /**
   * Reset progress to initial state and return it
   */
  abstract resetProgress(): TProgress;

  /**
   * Get the current progress state
   */
  get progress(): TProgress {
    return this._progress;
  }

  /**
   * Get the account ID
   */
  getAccountId(): number {
    return this.accountId;
  }

  /**
   * Get the account UUID
   */
  getAccountUUID(): string {
    return this.accountUUID;
  }

  /**
   * Pause any long-running work. Call resume() to continue.
   */
  pause(): void {
    this.paused = true;
    this.pauseListeners.forEach((listener) => listener(true));
  }

  /**
   * Resume work that was previously paused.
   */
  resume(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.pauseListeners.forEach((listener) => listener(false));
    const resolvers = [...this.pauseResolvers];
    this.pauseResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }

  /**
   * Wait until the controller is no longer paused. Safe to call repeatedly.
   */
  async waitForPause(): Promise<void> {
    while (this.paused) {
      await new Promise<void>((resolve) => {
        this.pauseResolvers.push(resolve);
      });
    }
  }

  /**
   * Subscribe to pause state changes. Returns an unsubscribe function.
   */
  onPauseChange(listener: (paused: boolean) => void): () => void {
    this.pauseListeners.push(listener);
    return () => {
      this.pauseListeners = this.pauseListeners.filter((cb) => cb !== listener);
    };
  }

  protected getAccountDirectory(): string {
    return buildAccountPaths(this.getAccountType(), this.accountUUID)
      .accountDir;
  }

  protected getAccountDatabaseSQLiteInfo(): {
    dbDir: string;
    dbName: string;
  } {
    const paths = buildAccountPaths(this.getAccountType(), this.accountUUID);
    return { dbDir: paths.dbDirForSQLite, dbName: paths.dbNameForSQLite };
  }

  /**
   * Ensure the account directory exists
   */
  protected async ensureAccountDirectory(): Promise<void> {
    const accountDir = this.getAccountDirectory();
    await ensureDirectoryExists(accountDir);
  }

  /**
   * Write metadata.json to the account directory
   */
  protected async writeMetadata(): Promise<void> {
    await this.ensureAccountDirectory();
    const paths = buildAccountPaths(this.getAccountType(), this.accountUUID);
    const metadataFile = new File(paths.metadataPath);
    const metadata = {
      type: this.getAccountType(),
      uuid: this.accountUUID,
    };
    metadataFile.write(JSON.stringify(metadata, null, 2));
  }

  /**
   * Open the account-specific database
   */
  protected async openAccountDatabase(): Promise<SQLiteDatabase> {
    if (this.db) {
      console.log(
        "[BaseAccountController] openAccountDatabase -> reuse instance db",
        {
          accountId: this.accountId,
          accountType: this.getAccountType(),
          accountUUID: this.accountUUID,
        },
      );
      return this.db;
    }

    await this.ensureAccountDirectory();
    const { dbDir, dbName } = this.getAccountDatabaseSQLiteInfo();
    const dbKey = `${dbDir}::${dbName}`;

    const existing = BaseAccountController.sharedAccountDbs.get(dbKey);
    if (existing) {
      existing.refCount += 1;
      this.sharedDbKey = dbKey;
      console.log(
        "[BaseAccountController] openAccountDatabase -> reuse shared db",
        {
          accountId: this.accountId,
          accountType: this.getAccountType(),
          accountUUID: this.accountUUID,
          dbKey,
          refCount: existing.refCount,
        },
      );
      return existing.db;
    }

    console.log(
      "[BaseAccountController] openAccountDatabase -> opening new db",
      {
        accountId: this.accountId,
        accountType: this.getAccountType(),
        accountUUID: this.accountUUID,
        dbKey,
        dbDir,
        dbName,
      },
    );
    const db = await openDatabaseAsync(dbName, {}, dbDir);
    await db.execAsync("PRAGMA foreign_keys = ON;");

    BaseAccountController.sharedAccountDbs.set(dbKey, { db, refCount: 1 });
    this.sharedDbKey = dbKey;
    console.log("[BaseAccountController] openAccountDatabase -> opened", {
      accountId: this.accountId,
      accountType: this.getAccountType(),
      accountUUID: this.accountUUID,
      dbKey,
      refCount: 1,
    });

    return db;
  }

  /**
   * Get the current schema version of the account database
   */
  protected async getSchemaVersion(): Promise<number> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    const result = await this.db.getFirstAsync<{ user_version: number }>(
      "PRAGMA user_version;",
    );
    return result?.user_version ?? 0;
  }

  /**
   * Set the schema version of the account database
   */
  protected async setSchemaVersion(version: number): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    await this.db.execAsync(`PRAGMA user_version = ${version};`);
  }

  /**
   * Get a configuration value from the account database
   */
  async getConfig(key: string): Promise<string | null> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    const result = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM config WHERE key = ?;",
      [key],
    );
    return result?.value ?? null;
  }

  /**
   * Set a configuration value in the account database
   */
  async setConfig(key: string, value: string): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    await this.db.runAsync(
      `INSERT INTO config (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
      [key, value],
    );
  }

  /**
   * Delete a configuration value from the account database
   */
  async deleteConfig(key: string): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    await this.db.runAsync("DELETE FROM config WHERE key = ?;", [key]);
  }

  /**
   * Update the accessedAt timestamp in the main database
   */
  protected async updateAccessedAt(): Promise<void> {
    const mainDb = await getDatabase();
    await mainDb.runAsync(
      `UPDATE bsky_account 
       SET accessedAt = ? 
       WHERE id = (SELECT bskyAccountID FROM account WHERE id = ?);`,
      [Date.now(), this.accountId],
    );
  }

  /**
   * Clean up resources when the controller is no longer needed
   */
  async cleanup(): Promise<void> {
    this._disposed = true;

    if (!this.db) {
      console.log("[BaseAccountController] cleanup -> skipped (no db)", {
        accountId: this.accountId,
        accountType: this.getAccountType(),
        accountUUID: this.accountUUID,
      });
      return;
    }

    const dbToRelease = this.db;
    const dbKey = this.sharedDbKey;

    this.db = null;
    this.sharedDbKey = null;

    console.log("[BaseAccountController] cleanup -> begin", {
      accountId: this.accountId,
      accountType: this.getAccountType(),
      accountUUID: this.accountUUID,
      dbKey,
    });

    if (dbKey) {
      const entry = BaseAccountController.sharedAccountDbs.get(dbKey);
      if (entry) {
        const beforeRefCount = entry.refCount;
        entry.refCount -= 1;
        console.log(
          "[BaseAccountController] cleanup -> shared refCount decremented",
          {
            accountId: this.accountId,
            accountType: this.getAccountType(),
            accountUUID: this.accountUUID,
            dbKey,
            beforeRefCount,
            afterRefCount: entry.refCount,
          },
        );
        if (entry.refCount <= 0) {
          BaseAccountController.sharedAccountDbs.delete(dbKey);
          console.log("[BaseAccountController] cleanup -> closing shared db", {
            accountId: this.accountId,
            accountType: this.getAccountType(),
            accountUUID: this.accountUUID,
            dbKey,
          });
          await entry.db.closeAsync();
        }
        return;
      }
    }

    console.log("[BaseAccountController] cleanup -> closing direct db", {
      accountId: this.accountId,
      accountType: this.getAccountType(),
      accountUUID: this.accountUUID,
      dbKey,
    });
    await dbToRelease.closeAsync();
  }
}

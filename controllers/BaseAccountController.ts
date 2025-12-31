import * as Crypto from "expo-crypto";
import { Directory, Paths } from "expo-file-system";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import { getDatabase } from "@/database";

function getDocumentsBasePath(): string {
  const baseDir = Paths.document ?? Paths.cache;
  if (!baseDir?.uri) {
    throw new Error("Unable to resolve a writable document directory");
  }
  const uri = baseDir.uri;
  return uri.endsWith("/") ? uri : `${uri}/`;
}

export function buildAccountPaths(accountType: string, accountUUID: string) {
  const base = getDocumentsBasePath();
  const accountsDir = `${base}accounts/`;
  const accountDir = `${accountsDir}${accountType}-${accountUUID}/`;
  return {
    base,
    accountsDir,
    accountDir,
    dbPath: `${accountDir}data.db`,
    // Relative path so SQLite writes to Documents/accounts/... instead of Documents/SQLite/
    dbPathForSQLite: `../accounts/${accountType}-${accountUUID}/data.db`,
    mediaDir: `${accountDir}media/`,
    mediaDirForDid: (did: string) =>
      `${accountDir}media/${encodeURIComponent(did)}/`,
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
  protected accountId: number;
  protected accountUUID: string;
  protected db: SQLiteDatabase | null = null;
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

  protected getAccountDatabasePathForSQLite(): string {
    return buildAccountPaths(this.getAccountType(), this.accountUUID)
      .dbPathForSQLite;
  }

  /**
   * Ensure the account directory exists
   */
  protected async ensureAccountDirectory(): Promise<void> {
    const accountDir = this.getAccountDirectory();
    await ensureDirectoryExists(accountDir);
  }

  /**
   * Open the account-specific database
   */
  protected async openAccountDatabase(): Promise<SQLiteDatabase> {
    await this.ensureAccountDirectory();
    const db = await openDatabaseAsync(this.getAccountDatabasePathForSQLite());
    await db.execAsync("PRAGMA foreign_keys = ON;");
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
      "PRAGMA user_version;"
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
      [key]
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
      [key, value]
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
      [Date.now(), this.accountId]
    );
  }

  /**
   * Clean up resources when the controller is no longer needed
   */
  async cleanup(): Promise<void> {
    if (this.db) {
      await this.db.closeAsync();
      this.db = null;
    }
  }
}

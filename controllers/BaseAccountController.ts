import * as Crypto from "expo-crypto";
import { Directory, Paths } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import { getDatabase } from "@/database";

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

  constructor(accountId: number, accountUUID?: string) {
    this.accountId = accountId;
    // If UUID not provided, generate one (will be overwritten when fetched from DB)
    this.accountUUID = accountUUID ?? Crypto.randomUUID();
    this._progress = this.resetProgress();
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
   * Get the directory path for this account's data
   */
  protected getAccountDirectoryHandle(): Directory {
    const type = this.getAccountType();
    const baseDirectory =
      Paths?.document ??
      Paths?.cache ??
      (LegacyFileSystem.documentDirectory
        ? new Directory(LegacyFileSystem.documentDirectory)
        : null) ??
      (LegacyFileSystem.cacheDirectory
        ? new Directory(LegacyFileSystem.cacheDirectory)
        : null);

    if (!baseDirectory) {
      throw new Error("Unable to resolve a writable document directory");
    }

    return new Directory(baseDirectory, `${type}-accounts`, this.accountUUID);
  }

  protected getAccountDirectory(): string {
    const accountDir = this.getAccountDirectoryHandle();
    const uri = accountDir.uri;
    return uri.endsWith("/") ? uri : `${uri}/`;
  }

  /**
   * Get the database file path for this account
   */
  protected getDatabasePath(): string {
    return `${this.getAccountDirectory()}data.sqlite3`;
  }

  /**
   * Ensure the account directory exists
   */
  protected async ensureAccountDirectory(): Promise<void> {
    const accountDir = this.getAccountDirectoryHandle();

    if (!accountDir.exists) {
      accountDir.create({ intermediates: true, idempotent: true });
    }
  }

  /**
   * Open the account-specific database
   */
  protected async openAccountDatabase(): Promise<SQLiteDatabase> {
    await this.ensureAccountDirectory();
    const dbPath = `${this.getAccountType()}-accounts/${
      this.accountUUID
    }/data.sqlite3`;
    const db = await openDatabaseAsync(dbPath);
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

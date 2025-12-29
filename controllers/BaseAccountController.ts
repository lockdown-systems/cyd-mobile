import * as FileSystem from "expo-file-system";
import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";

import { getDatabase } from "@/database";

// Helper to generate UUID v4
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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

  constructor(accountId: number, accountUUID?: string) {
    this.accountId = accountId;
    // If UUID not provided, generate one (will be overwritten when fetched from DB)
    this.accountUUID = accountUUID ?? generateUUID();
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
  protected getAccountDirectory(): string {
    const type = this.getAccountType();
    return `${FileSystem.documentDirectory}${type}-accounts/${this.accountUUID}/`;
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
    const dir = this.getAccountDirectory();
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
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
    const db = openDatabaseSync(dbPath);
    db.execSync("PRAGMA foreign_keys = ON;");
    return db;
  }

  /**
   * Get the current schema version of the account database
   */
  protected getSchemaVersion(): number {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    const result = this.db.getFirstSync<{ user_version: number }>(
      "PRAGMA user_version;"
    );
    return result?.user_version ?? 0;
  }

  /**
   * Set the schema version of the account database
   */
  protected setSchemaVersion(version: number): void {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    this.db.execSync(`PRAGMA user_version = ${version};`);
  }

  /**
   * Get a configuration value from the account database
   */
  async getConfig(key: string): Promise<string | null> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    const result = this.db.getFirstSync<{ value: string }>(
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
    this.db.runSync(
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
    this.db.runSync("DELETE FROM config WHERE key = ?;", [key]);
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
      this.db.closeSync();
      this.db = null;
    }
  }
}

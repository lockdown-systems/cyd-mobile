import type { LocalAccountIdentity } from "./identity";

/**
 * The platform capabilities restoring a Cyd Bluesky archive needs.
 *
 * Restore is pure logic over these ports, the same way intake and export are:
 * reading the prepared archive out of staging, creating a Bluesky local
 * account, writing its private database, and copying media into it. React
 * Native supplies them from `expo-sqlite` and `expo-file-system`; tests supply
 * a Node adapter, which is what lets the committed real-data fixtures be
 * restored and browsed in a test rather than on a phone.
 */

/** Read-only access to the archive's interchange database. */
export type ReadableInterchangeDatabase = {
  all<T>(sql: string): Promise<T[]>;
  close(): Promise<void>;
};

/** Where intake left a prepared archive (#95). */
export type PreparedArchiveLocation = {
  /** The import's stable id, which also names its staging directory. */
  intakeId: string;
  stagingRoot: string;
};

/** One prepared archive sitting in intake's staging area. */
export type PreparedArchiveStore = {
  openInterchange(): Promise<ReadableInterchangeDatabase>;
  /** Stream a staged media payload, in whatever chunks storage gives back. */
  readPayload(
    archivePath: string,
    onBytes: (bytes: Uint8Array) => void,
  ): Promise<void>;
  /**
   * Remove the staging this archive was prepared into.
   *
   * Called once the account is committed, and never before: staging is working
   * state whose only purpose was this restore, but until the restore lands it
   * is also what makes retrying cheap.
   */
  discard(): Promise<void>;
};

/** The Bluesky local account's own private database, mid-restore. */
export type RestoredAccountDatabase = {
  run(sql: string, params: unknown[]): Promise<void>;
  /** Run `work` so that either all of its writes land or none do. */
  transaction(work: () => Promise<void>): Promise<void>;
  close(): Promise<void>;
};

/**
 * The `bsky_account` columns a Cyd Bluesky archive's portable settings can set.
 *
 * A closed set rather than free strings, because both adapters interpolate
 * these names straight into SQL: nothing that is not one of Mobile's own
 * settings columns can reach a statement.
 */
export const RESTORABLE_SETTING_COLUMNS = [
  "settingSavePosts",
  "settingSaveLikes",
  "settingSaveBookmarks",
  "settingSaveChats",
  "settingDeletePosts",
  "settingDeleteReposts",
  "settingDeleteLikes",
  "settingDeleteBookmarks",
  "settingDeleteChats",
  "settingDeleteUnfollowEveryone",
] as const;

export type RestorableSettingColumn = (typeof RESTORABLE_SETTING_COLUMNS)[number];

/**
 * What the archive asked for, as Mobile's own columns.
 *
 * Only the settings it actually carried appear, so an archive that says
 * nothing about chats leaves Mobile's default alone.
 */
export type RestoredAccountSettings = Partial<
  Record<RestorableSettingColumn, 0 | 1>
>;

export type NewLocalAccountRequest = {
  uuid: string;
  did: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** Save and delete defaults from the archive, as Mobile's own columns. */
  settings: RestoredAccountSettings;
};

export type CreatedLocalAccount = {
  accountId: number;
  accountUuid: string;
};

export type DiscardableAccount = {
  accountId: number | null;
  accountUuid: string;
};

export type StoredMediaFile = {
  /** Where the file now lives, as Mobile records local media paths. */
  uri: string;
  byteLength: number;
};

export type BlueskyArchiveRestoreEnvironment = {
  openPreparedArchive(archive: PreparedArchiveLocation): PreparedArchiveStore;

  /** Every Bluesky local account this installation already has. */
  listLocalAccountIdentities(): Promise<LocalAccountIdentity[]>;

  /**
   * Create the Bluesky local account and its empty, migrated database.
   *
   * The account is created disconnected: no Bluesky connection is written, and
   * no schedule is set. Establishing a connection is a separate act on each
   * installation, and an archive never carries one.
   */
  createLocalAccount(
    request: NewLocalAccountRequest,
  ): Promise<CreatedLocalAccount>;

  openAccountDatabase(accountUuid: string): Promise<RestoredAccountDatabase>;

  /**
   * Copy a staged payload into the account's own media storage.
   *
   * `fileName` is content-addressed, so restoring an archive that references
   * the same bytes from several records writes one file (ADR 0007).
   */
  storeAccountMedia(
    accountUuid: string,
    fileName: string,
    write: (push: (bytes: Uint8Array) => void) => Promise<void>,
  ): Promise<StoredMediaFile>;

  /**
   * Remove a half-restored account, leaving the installation as it was.
   *
   * `accountId` is null when the restore failed before the account row
   * existed. Its media may still have been copied, so the account's directory
   * is removed either way.
   */
  discardLocalAccount(account: DiscardableAccount): Promise<void>;

  newUuid(): string;
  now(): Date;
};

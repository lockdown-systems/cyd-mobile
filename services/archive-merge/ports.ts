import type {
  DiscardableAccount,
  LocalAccountIdentity,
  PreparedArchiveLocation,
  PreparedArchiveStore,
  RestoredAccountDatabase,
  StoredMediaFile,
} from "@/services/archive-restore";

/**
 * The platform capabilities a recovery merge needs, and deliberately no more.
 *
 * What is missing from this list is the point of it. There is no way from here
 * to write a Bluesky local account's settings or schedule, to touch a Bluesky
 * connection, or to rename an account: a merge into an existing Bluesky local
 * account can only add to that account's Bluesky saved data, so "an existing
 * identity keeps its UUID, its settings, its schedules and its connection" is
 * a property of the interface rather than a promise somebody has to keep.
 *
 * The exceptions are the two ports duplicate-DID reconciliation needs, which
 * is the one moment a person is asked to choose between two local accounts'
 * settings (ADR 0011). They are named for that job so they cannot be reached
 * for by accident.
 */

/** An existing account's database, which a merge reads before it writes. */
export type MergeableAccountDatabase = RestoredAccountDatabase & {
  all<T>(sql: string): Promise<T[]>;
};

/**
 * The `bsky_account` columns duplicate-DID reconciliation carries over from
 * the account whose settings the person chose to keep.
 *
 * Schedule columns are here because a surviving Bluesky local account has to
 * keep a schedule somebody set. A Bluesky scheduled reminder still only
 * prompts a review — carrying it across does not authorize unattended
 * deletion, and there is nothing here that could.
 */
export const RECONCILABLE_SETTING_COLUMNS = [
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
  "settingScheduleDeletion",
  "settingScheduleDeletionFrequency",
  "settingScheduleDeletionDayOfMonth",
  "settingScheduleDeletionDayOfWeek",
  "settingScheduleDeletionTime",
] as const;

export type ReconcilableSettingColumn =
  (typeof RECONCILABLE_SETTING_COLUMNS)[number];

/** One account's settings, as the person would compare them side by side. */
export type ReconcilableAccountSettings = Partial<
  Record<ReconcilableSettingColumn, string | number | null>
>;

export type BlueskyArchiveMergeEnvironment = {
  openPreparedArchive(archive: PreparedArchiveLocation): PreparedArchiveStore;

  /** Every Bluesky local account this installation has, for routing (#97). */
  listLocalAccountIdentities(): Promise<LocalAccountIdentity[]>;

  openAccountDatabase(accountUuid: string): Promise<MergeableAccountDatabase>;

  /**
   * Copy a staged payload into the account's own media storage.
   *
   * Content-addressed, so a file the account already holds is written once
   * (ADR 0007) and merging the same archive twice copies nothing new.
   */
  storeAccountMedia(
    accountUuid: string,
    fileName: string,
    write: (push: (bytes: Uint8Array) => void) => Promise<void>,
  ): Promise<StoredMediaFile>;

  /**
   * Where a file of this name will live inside an account's media storage.
   *
   * Media is content-addressed, so a merge can say where a file is going
   * before it moves the bytes. That is what lets somebody be shown the exact
   * rows a merge would write without anything being written.
   */
  accountMediaUri(accountUuid: string, fileName: string): string;

  /** What a duplicate Bluesky local account is set to do, for the preview. */
  readAccountSettings(
    accountUuid: string,
  ): Promise<ReconcilableAccountSettings>;

  /** Give the surviving account the settings the person picked (ADR 0011). */
  applyAccountSettings(
    accountUuid: string,
    settings: ReconcilableAccountSettings,
  ): Promise<void>;

  /**
   * Move a media file from a duplicate Bluesky local account into the one that
   * survives, returning where it now lives. Null when the file is gone, which
   * makes the record a failed download rather than a failed reconciliation.
   */
  adoptAccountMedia(
    sourceAccountUuid: string,
    targetAccountUuid: string,
    localPath: string,
  ): Promise<StoredMediaFile | null>;

  /**
   * Make one Bluesky local account per DID a rule of the database again.
   *
   * Mobile has carried a unique index on `bsky_account.did` since its first
   * migration, so duplicates can only reach an installation from outside it —
   * a database restored from an OS backup, or one that predates the index.
   * Reconciliation ends by putting the rule back, which is also the check that
   * the duplicates really are gone: the statement fails while any remain.
   */
  enforceOneAccountPerDid(): Promise<void>;

  /** Remove a reconciled-away Bluesky local account and its storage. */
  removeLocalAccount(account: DiscardableAccount): Promise<void>;

  now(): Date;
};

export type { PreparedArchiveLocation, StoredMediaFile };

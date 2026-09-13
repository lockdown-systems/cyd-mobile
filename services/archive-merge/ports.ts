import type {
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
 * connection, to rename an account or to remove one: a merge into an existing
 * Bluesky local account can only add to that account's Bluesky saved data, so
 * "an existing identity keeps its UUID, its settings, its schedules and its
 * connection" is a property of the interface rather than a promise somebody
 * has to keep.
 */

/** An existing account's database, which a merge reads before it writes. */
export type MergeableAccountDatabase = RestoredAccountDatabase & {
  all<T>(sql: string): Promise<T[]>;
};

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
};

export type { PreparedArchiveLocation, StoredMediaFile };

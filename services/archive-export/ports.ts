import type { CreateHasher } from "@/services/archive-import/ports";

/**
 * The platform capabilities a Cyd Bluesky archive export needs.
 *
 * Export is pure logic over these ports, the same way intake is: pausing
 * account work, snapshotting SQLite, reading preserved media, hashing, and
 * writing staged files. React Native supplies them from `expo-sqlite` and
 * `expo-file-system`; a Node adapter supplies them from `node:sqlite` and
 * `node:fs`, which is what lets a curated test account be exported into a
 * committed fixture without a device round trip (ADR 0016).
 */

export type { CreateHasher, Hasher } from "@/services/archive-import/ports";

/** Read-only, synchronous access to a staged SQLite snapshot. */
export type ReadableDatabase = {
  all<T>(sql: string): T[];
  close(): void;
};

/** The Bluesky interchange database being built in staging. */
export type WritableDatabase = {
  exec(sql: string): void;
  run(sql: string, params: unknown[]): void;
  close(): void;
};

export type StagedFileWriter = {
  write(chunk: Uint8Array): void;
  close(): void;
};

/**
 * A directory that only ever holds one export's working files.
 *
 * Everything an export produces lands here first — the database snapshot, the
 * Bluesky interchange database, the archive itself — so a failure or
 * cancellation is one directory to delete, and nothing half-written is ever mistaken for a
 * finished Cyd Bluesky archive.
 */
export type ExportStagingArea = {
  readonly root: string;
  createFile(relativePath: string): StagedFileWriter;
  /** Absolute location of a staged file, for the file and SQLite ports. */
  locate(relativePath: string): string;
  destroy(): void;
};

export type FileStat = { byteLength: number };

export type BlueskyArchiveExportEnvironment = {
  openStaging(exportId: string): ExportStagingArea;

  /**
   * Hold account-mutating work still for the duration of `work`.
   *
   * The pause is what makes the snapshot and the media inventory describe one
   * moment (ADR 0010), so it covers as little as possible: a SQLite copy and a
   * stat of each preserved file, never hashing or packaging.
   */
  withAccountWorkPaused<T>(work: () => Promise<T>): Promise<T>;

  /** Copy the live account database into staging as one consistent snapshot. */
  snapshotAccountDatabase(
    staging: ExportStagingArea,
    relativePath: string,
  ): Promise<void>;

  openSnapshot(staging: ExportStagingArea, relativePath: string): ReadableDatabase;

  /** Create an empty database in staging for the Bluesky interchange model. */
  createBlueskyInterchangeDatabase(
    staging: ExportStagingArea,
    relativePath: string,
  ): WritableDatabase;

  /** Size of a file, or null when it is not there. */
  statFile(location: string): FileStat | null;

  /** Stream a file, in whatever chunks storage gives back. */
  readFile(
    location: string,
    onBytes: (bytes: Uint8Array) => void,
  ): Promise<void>;

  createHasher: CreateHasher;
  now(): Date;
};

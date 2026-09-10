/**
 * The platform capabilities Bluesky archive intake needs.
 *
 * Intake is pure logic over these ports: random-access reads of the picked
 * file, writes confined to a staging area, hashing, and decompression. React
 * Native supplies them from `expo-file-system` and friends; tests supply
 * in-memory equivalents, which is what makes the adversarial cases (traversal,
 * forged manifests, zip bombs, termination mid-entry) testable at all.
 */

/** Random-access reads over the archive the person picked. */
export type ArchiveByteReader = {
  readonly byteLength: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  close(): void;
};

export type Hasher = {
  update(chunk: Uint8Array): void;
  digestHex(): string;
};

export type CreateHasher = () => Hasher;

/** A streaming decompressor that emits plain bytes as they become available. */
export type Decompressor = {
  push(chunk: Uint8Array, final: boolean): void;
};

export type CreateDecompressor = (
  onBytes: (bytes: Uint8Array) => void,
) => Decompressor;

export type StagedFileWriter = {
  write(chunk: Uint8Array): void;
  close(): void;
};

/**
 * A directory that only ever holds one import's working files.
 *
 * Paths are staging-relative and are rejected if they would escape the root,
 * so no archive entry can reach a live Bluesky local account.
 */
export type ArchiveStagingArea = {
  readonly root: string;
  createFile(relativePath: string): StagedFileWriter;
  fileExists(relativePath: string): boolean;
  fileSize(relativePath: string): number | null;
  readText(relativePath: string): string | null;
  writeText(relativePath: string, contents: string): void;
  /** Delete the staging area and everything in it. */
  destroy(): void;
};

export type ArchiveIntakeEnvironment = {
  /** Open (creating if needed) the staging area for one import. */
  openStaging(intakeId: string): ArchiveStagingArea;
  /** Staging areas left behind by earlier runs, resumable or not. */
  listStagingIds(): string[];
  /** Free space on the volume holding staging, in bytes. */
  availableStorageBytes(): number;
  createHasher: CreateHasher;
  createDecompressor: CreateDecompressor;
  now(): Date;
};

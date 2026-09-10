import { Crc32 } from "@/services/archive-import/crc32";
import { checkZipEntryPath } from "@/services/archive-import/entry-paths";

import { BlueskyArchiveExportError } from "./errors";

/**
 * The ZIP half of a Cyd Bluesky archive writer.
 *
 * Every entry's header is complete before its first byte is written, so an
 * archive is produced in one sequential pass with no seeking and no data
 * descriptors. That is why callers declare each entry's size and CRC up front:
 * both come from an earlier pass over the same bytes, and re-checking them here
 * turns "the file changed underneath us" into an error instead of a corrupt
 * archive.
 *
 * Media is stored rather than deflated. JPEG and MP4 do not compress, and a
 * streaming deflate cannot know its compressed size until it finishes — which
 * on a phone packaging a multi-gigabyte video would mean buffering the whole
 * entry. Something already compressed into a staged file can be added with
 * {@link BlueskyArchiveZipWriter.addDeflatedEntry}, which is how `data.db` gets
 * in without paying for its empty SQLite pages.
 */

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

const STORED = 0;
const DEFLATED = 8;
const VERSION_NEEDED = 20;
/** "Made by" Unix (3), so the mode in the external attributes is meaningful. */
const VERSION_MADE_BY = (3 << 8) | VERSION_NEEDED;
/** Bit 11: entry names are UTF-8. */
const FLAG_UTF8_NAMES = 0x0800;
/** A regular file, rw-r--r--, in the high 16 bits of the external attributes. */
const REGULAR_FILE_ATTRIBUTES = 0o100644 << 16;

/** ZIP without ZIP64 cannot describe an entry or an offset past this. */
const MAX_ZIP32_BYTES = 0xffffffff;

/** Where an archive's bytes go: a staged file on device, memory in tests. */
export type ArchiveByteSink = {
  write(chunk: Uint8Array): void;
  close(): void;
};

export type DeclaredEntry = {
  byteLength: number;
  crc32: number;
};

/** Hands an entry's bytes to the writer, in as many chunks as it likes. */
export type EntryProducer = (push: (bytes: Uint8Array) => void) => Promise<void>;

type WrittenEntry = {
  path: string;
  method: number;
  byteLength: number;
  compressedByteLength: number;
  crc32: number;
  localHeaderOffset: number;
};

const encoder = new TextEncoder();

function uint16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

/** MS-DOS date and time, which is what a ZIP header carries. */
function dosTimestamp(date: Date): { time: number; date: number } {
  const year = Math.max(date.getUTCFullYear(), 1980);
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      (date.getUTCSeconds() >> 1),
    date:
      ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

export class BlueskyArchiveZipWriter {
  private readonly entries: WrittenEntry[] = [];
  private readonly dos: { time: number; date: number };
  private offset = 0;
  private finished = false;

  constructor(
    private readonly sink: ArchiveByteSink,
    options: { modifiedAt?: Date } = {},
  ) {
    this.dos = dosTimestamp(options.modifiedAt ?? new Date(Date.UTC(1980, 0, 1)));
  }

  /**
   * Write one entry, streaming its bytes straight through to the sink.
   *
   * A size or checksum that disagrees with what was declared throws *after*
   * the entry's header is already written, so the caller must treat a failure
   * here as fatal to the whole archive and discard it. That is the point: an
   * archive whose payload no longer matches what was hashed is exactly what
   * the manifest exists to make impossible.
   */
  async addStoredEntry(
    path: string,
    declared: DeclaredEntry,
    produce: EntryProducer,
  ): Promise<void> {
    await this.addEntry(path, { ...declared, method: STORED }, produce);
  }

  /**
   * Write an entry whose bytes were already compressed into staging.
   *
   * `byteLength` and `crc32` describe the *original*, because that is what a
   * ZIP header records and what a reader checks after inflating. The writer
   * can only verify the compressed byte count itself; the checksum comes from
   * the compression pass, which is the one place that saw the original bytes.
   */
  async addDeflatedEntry(
    path: string,
    declared: DeclaredEntry & { compressedByteLength: number },
    produce: EntryProducer,
  ): Promise<void> {
    await this.addEntry(path, { ...declared, method: DEFLATED }, produce);
  }

  private async addEntry(
    path: string,
    declared: DeclaredEntry & { method: number; compressedByteLength?: number },
    produce: EntryProducer,
  ): Promise<void> {
    this.requireUnfinished();
    const compressedByteLength =
      declared.compressedByteLength ?? declared.byteLength;
    const verifyChecksum = declared.method === STORED;
    const safePath = this.requireEntryPath(path);
    if (this.entries.some((entry) => entry.path === safePath)) {
      throw new BlueskyArchiveExportError(
        "invalid-entry",
        `Refusing to write ${safePath} into the archive more than once.`,
      );
    }
    if (
      declared.byteLength > MAX_ZIP32_BYTES ||
      compressedByteLength > MAX_ZIP32_BYTES ||
      this.offset > MAX_ZIP32_BYTES
    ) {
      throw new BlueskyArchiveExportError(
        "archive-too-large",
        "This archive is larger than the Cyd Bluesky archive format can describe.",
      );
    }

    const name = encoder.encode(safePath);
    const localHeaderOffset = this.offset;

    this.push(uint32(LOCAL_FILE_HEADER_SIGNATURE));
    this.push(uint16(VERSION_NEEDED));
    this.push(uint16(FLAG_UTF8_NAMES));
    this.push(uint16(declared.method));
    this.push(uint16(this.dos.time));
    this.push(uint16(this.dos.date));
    this.push(uint32(declared.crc32));
    this.push(uint32(compressedByteLength));
    this.push(uint32(declared.byteLength));
    this.push(uint16(name.length));
    this.push(uint16(0));
    this.push(name);

    const checksum = new Crc32();
    let written = 0;
    await produce((bytes) => {
      written += bytes.length;
      if (written > compressedByteLength) {
        throw new BlueskyArchiveExportError(
          "asset-changed",
          `${safePath} declared ${compressedByteLength} bytes but produced more.`,
        );
      }
      checksum.update(bytes);
      this.push(bytes);
    });

    if (written !== compressedByteLength) {
      throw new BlueskyArchiveExportError(
        "asset-changed",
        `${safePath} declared ${compressedByteLength} bytes but produced ${written}.`,
      );
    }
    if (verifyChecksum && checksum.value() !== declared.crc32 >>> 0) {
      throw new BlueskyArchiveExportError(
        "asset-changed",
        `${safePath} changed while it was being packaged.`,
      );
    }

    this.entries.push({
      path: safePath,
      method: declared.method,
      byteLength: declared.byteLength,
      compressedByteLength,
      crc32: declared.crc32,
      localHeaderOffset,
    });
  }

  /** Write the central directory and close the sink. */
  finish(): void {
    this.requireUnfinished();
    this.finished = true;

    const centralDirectoryOffset = this.offset;
    for (const entry of this.entries) {
      const name = encoder.encode(entry.path);
      this.push(uint32(CENTRAL_FILE_HEADER_SIGNATURE));
      this.push(uint16(VERSION_MADE_BY));
      this.push(uint16(VERSION_NEEDED));
      this.push(uint16(FLAG_UTF8_NAMES));
      this.push(uint16(entry.method));
      this.push(uint16(this.dos.time));
      this.push(uint16(this.dos.date));
      this.push(uint32(entry.crc32));
      this.push(uint32(entry.compressedByteLength));
      this.push(uint32(entry.byteLength));
      this.push(uint16(name.length));
      this.push(uint16(0));
      this.push(uint16(0));
      this.push(uint16(0));
      this.push(uint16(0));
      this.push(uint32(REGULAR_FILE_ATTRIBUTES));
      this.push(uint32(entry.localHeaderOffset));
      this.push(name);
    }
    const centralDirectoryBytes = this.offset - centralDirectoryOffset;

    this.push(uint32(END_OF_CENTRAL_DIRECTORY_SIGNATURE));
    this.push(uint16(0));
    this.push(uint16(0));
    this.push(uint16(this.entries.length));
    this.push(uint16(this.entries.length));
    this.push(uint32(centralDirectoryBytes));
    this.push(uint32(centralDirectoryOffset));
    this.push(uint16(0));

    this.sink.close();
  }

  /** Total bytes written so far, which is the archive's size once finished. */
  get byteLength(): number {
    return this.offset;
  }

  private push(bytes: Uint8Array): void {
    this.sink.write(bytes);
    this.offset += bytes.length;
  }

  private requireUnfinished(): void {
    if (this.finished) {
      throw new BlueskyArchiveExportError(
        "invalid-entry",
        "This archive has already been finished.",
      );
    }
  }

  private requireEntryPath(path: string): string {
    const check = checkZipEntryPath(path);
    if (!check.ok || check.isDirectory) {
      throw new BlueskyArchiveExportError(
        "invalid-entry",
        `Refusing to write an archive entry at ${path}: an entry path must be a normalized relative file path.`,
      );
    }
    return check.path;
  }
}

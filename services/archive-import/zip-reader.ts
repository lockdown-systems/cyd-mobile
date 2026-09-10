import { Crc32 } from "./crc32";
import { ArchiveIntakeError } from "./errors";
import { checkArchiveEntryPath, decodeArchiveEntryName } from "./entry-paths";
import type {
  ArchiveByteReader,
  CreateDecompressor,
  CreateHasher,
} from "./ports";

/**
 * A defensive, entry-at-a-time ZIP reader.
 *
 * It reads the central directory, decides which entries are safe, and streams
 * one entry at a time. Nothing here writes to the filesystem, and nothing
 * trusts a length it has not checked: an entry stops the moment it produces
 * more bytes than it declared, which is what keeps a zip bomb from ever
 * reaching storage.
 */

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06064b50;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

const END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const ZIP64_LOCATOR_BYTES = 20;
const CENTRAL_FILE_HEADER_BYTES = 46;
const LOCAL_FILE_HEADER_BYTES = 30;
const MAX_COMMENT_BYTES = 0xffff;

/** A central directory larger than this is a resource-exhaustion attempt. */
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;

/** How much compressed data to pull from storage at a time. */
const READ_CHUNK_BYTES = 256 * 1024;

const STORED = 0;
const DEFLATED = 8;

/** General purpose bit flags that mean the entry is encrypted. */
const FLAG_ENCRYPTED = 0x0001;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_MASKED_LOCAL_HEADERS = 0x2000;

const UNIX_FILE_TYPE_MASK = 0xf000;
const UNIX_REGULAR_FILE = 0x8000;
const UNIX_DIRECTORY = 0x4000;
const MSDOS_DIRECTORY_ATTRIBUTE = 0x10;

export type ZipEntry = {
  /** Validated, staging-relative path. */
  path: string;
  method: number;
  compressedBytes: number;
  uncompressedBytes: number;
  crc32: number;
  localHeaderOffset: number;
};

export type ZipCentralDirectory = {
  /** File entries, in central directory order. Directory entries are dropped. */
  entries: ZipEntry[];
  directoryEntryCount: number;
  totalCompressedBytes: number;
  totalUncompressedBytes: number;
};

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readUint64(data: DataView, offset: number, field: string): number {
  const value = data.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ArchiveIntakeError(
      "not-an-archive",
      `The archive declares an unreadable ${field}.`,
    );
  }
  return Number(value);
}

type EndOfCentralDirectory = {
  entryCount: number;
  centralDirectoryOffset: number;
  centralDirectoryBytes: number;
};

async function readEndOfCentralDirectory(
  reader: ArchiveByteReader,
): Promise<EndOfCentralDirectory> {
  if (reader.byteLength < END_OF_CENTRAL_DIRECTORY_BYTES) {
    throw new ArchiveIntakeError(
      "not-an-archive",
      "This file is too small to be a Cyd Bluesky archive.",
    );
  }

  const trailerBytes = Math.min(
    reader.byteLength,
    END_OF_CENTRAL_DIRECTORY_BYTES + MAX_COMMENT_BYTES + ZIP64_LOCATOR_BYTES,
  );
  const trailerStart = reader.byteLength - trailerBytes;
  const trailer = await reader.read(trailerStart, trailerBytes);
  const trailerView = view(trailer);

  for (
    let index = trailer.length - END_OF_CENTRAL_DIRECTORY_BYTES;
    index >= 0;
    index -= 1
  ) {
    if (trailerView.getUint32(index, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }
    const commentBytes = trailerView.getUint16(index + 20, true);
    const expectedCommentBytes =
      reader.byteLength - (trailerStart + index) - END_OF_CENTRAL_DIRECTORY_BYTES;
    if (commentBytes !== expectedCommentBytes) {
      continue;
    }

    const diskNumber = trailerView.getUint16(index + 4, true);
    const centralDirectoryDisk = trailerView.getUint16(index + 6, true);
    const entriesOnDisk = trailerView.getUint16(index + 8, true);
    const entryCount = trailerView.getUint16(index + 10, true);
    const centralDirectoryBytes = trailerView.getUint32(index + 12, true);
    const centralDirectoryOffset = trailerView.getUint32(index + 16, true);

    const needsZip64 =
      diskNumber === 0xffff ||
      centralDirectoryDisk === 0xffff ||
      entryCount === 0xffff ||
      centralDirectoryBytes === 0xffffffff ||
      centralDirectoryOffset === 0xffffffff;

    if (!needsZip64) {
      if (diskNumber !== 0 || centralDirectoryDisk !== 0) {
        throw new ArchiveIntakeError(
          "unsupported-zip-feature",
          "Split or multi-disk archives are not supported.",
        );
      }
      if (entriesOnDisk !== entryCount) {
        throw new ArchiveIntakeError(
          "not-an-archive",
          "The archive's directory disagrees with itself about how many entries it has.",
        );
      }
      return { entryCount, centralDirectoryOffset, centralDirectoryBytes };
    }

    return readZip64EndOfCentralDirectory(reader, trailer, trailerStart, index);
  }

  throw new ArchiveIntakeError(
    "not-an-archive",
    "This file is not a Cyd Bluesky archive.",
  );
}

async function readZip64EndOfCentralDirectory(
  reader: ArchiveByteReader,
  trailer: Uint8Array,
  trailerStart: number,
  endOfCentralDirectoryIndex: number,
): Promise<EndOfCentralDirectory> {
  const locatorIndex = endOfCentralDirectoryIndex - ZIP64_LOCATOR_BYTES;
  if (locatorIndex < 0) {
    throw new ArchiveIntakeError(
      "not-an-archive",
      "The archive is missing its ZIP64 directory locator.",
    );
  }

  const trailerView = view(trailer);
  if (trailerView.getUint32(locatorIndex, true) !== ZIP64_LOCATOR_SIGNATURE) {
    throw new ArchiveIntakeError(
      "not-an-archive",
      "The archive is missing its ZIP64 directory locator.",
    );
  }
  if (trailerView.getUint32(locatorIndex + 16, true) !== 1) {
    throw new ArchiveIntakeError(
      "unsupported-zip-feature",
      "Split or multi-disk archives are not supported.",
    );
  }

  const recordOffset = readUint64(
    trailerView,
    locatorIndex + 8,
    "ZIP64 directory offset",
  );
  if (recordOffset + 56 > trailerStart + endOfCentralDirectoryIndex) {
    throw new ArchiveIntakeError(
      "not-an-archive",
      "The archive's ZIP64 directory is outside the file.",
    );
  }

  const record = view(await reader.read(recordOffset, 56));
  if (record.getUint32(0, true) !== ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    throw new ArchiveIntakeError(
      "not-an-archive",
      "The archive's ZIP64 directory is missing.",
    );
  }
  if (record.getUint32(16, true) !== 0 || record.getUint32(20, true) !== 0) {
    throw new ArchiveIntakeError(
      "unsupported-zip-feature",
      "Split or multi-disk archives are not supported.",
    );
  }

  const entriesOnDisk = readUint64(record, 24, "entry count");
  const entryCount = readUint64(record, 32, "entry count");
  if (entriesOnDisk !== entryCount) {
    throw new ArchiveIntakeError(
      "not-an-archive",
      "The archive's directory disagrees with itself about how many entries it has.",
    );
  }

  return {
    entryCount,
    centralDirectoryBytes: readUint64(record, 40, "directory size"),
    centralDirectoryOffset: readUint64(record, 48, "directory offset"),
  };
}

/** Pull the ZIP64 extended information field out of a central header's extras. */
function readZip64Extra(
  extra: Uint8Array,
  wanted: { uncompressed: boolean; compressed: boolean; localOffset: boolean },
): { uncompressed?: number; compressed?: number; localOffset?: number } {
  const extraView = view(extra);
  let cursor = 0;
  while (cursor + 4 <= extra.length) {
    const headerId = extraView.getUint16(cursor, true);
    const dataBytes = extraView.getUint16(cursor + 2, true);
    const dataStart = cursor + 4;
    if (dataStart + dataBytes > extra.length) {
      break;
    }
    if (headerId === 0x0001) {
      const values: {
        uncompressed?: number;
        compressed?: number;
        localOffset?: number;
      } = {};
      let field = dataStart;
      const takeField = (name: string): number => {
        if (field + 8 > dataStart + dataBytes) {
          throw new ArchiveIntakeError(
            "not-an-archive",
            "The archive has a truncated ZIP64 entry header.",
          );
        }
        const value = readUint64(extraView, field, name);
        field += 8;
        return value;
      };
      if (wanted.uncompressed) {
        values.uncompressed = takeField("entry size");
      }
      if (wanted.compressed) {
        values.compressed = takeField("entry size");
      }
      if (wanted.localOffset) {
        values.localOffset = takeField("entry offset");
      }
      return values;
    }
    cursor = dataStart + dataBytes;
  }
  return {};
}

function assertSupportedEntry(
  path: string,
  isDirectory: boolean,
  flags: number,
  method: number,
  madeByHost: number,
  externalAttributes: number,
): void {
  if (
    (flags & FLAG_ENCRYPTED) !== 0 ||
    (flags & FLAG_STRONG_ENCRYPTION) !== 0 ||
    (flags & FLAG_MASKED_LOCAL_HEADERS) !== 0
  ) {
    throw new ArchiveIntakeError(
      "unsupported-zip-feature",
      "Encrypted archives are not supported.",
    );
  }

  if (madeByHost === 3 || madeByHost === 19) {
    const fileType = (externalAttributes >>> 16) & UNIX_FILE_TYPE_MASK;
    const expected = isDirectory ? UNIX_DIRECTORY : UNIX_REGULAR_FILE;
    if (fileType !== 0 && fileType !== expected) {
      throw new ArchiveIntakeError(
        "unsupported-entry-type",
        `The archive contains an entry that is not a regular file: ${path}`,
      );
    }
  }

  if (!isDirectory && (externalAttributes & MSDOS_DIRECTORY_ATTRIBUTE) !== 0) {
    throw new ArchiveIntakeError(
      "unsupported-entry-type",
      `The archive contains an entry that is not a regular file: ${path}`,
    );
  }

  if (!isDirectory && method !== STORED && method !== DEFLATED) {
    throw new ArchiveIntakeError(
      "unsupported-zip-feature",
      `The archive uses an unsupported compression method for ${path}.`,
    );
  }
}

/**
 * Read and vet the central directory.
 *
 * Every structural decision the importer later relies on is made here, before
 * a single byte of entry content is touched.
 */
export async function readZipCentralDirectory(
  reader: ArchiveByteReader,
  options: { maxEntries: number },
): Promise<ZipCentralDirectory> {
  const { entryCount, centralDirectoryOffset, centralDirectoryBytes } =
    await readEndOfCentralDirectory(reader);

  if (entryCount > options.maxEntries) {
    throw new ArchiveIntakeError(
      "too-many-entries",
      `The archive declares ${entryCount} entries, more than the ${options.maxEntries} Cyd will read.`,
    );
  }
  if (centralDirectoryBytes > MAX_CENTRAL_DIRECTORY_BYTES) {
    throw new ArchiveIntakeError(
      "too-many-entries",
      "The archive's directory is too large to read.",
    );
  }
  if (centralDirectoryOffset + centralDirectoryBytes > reader.byteLength) {
    throw new ArchiveIntakeError(
      "not-an-archive",
      "The archive's directory is outside the file.",
    );
  }

  const central = await reader.read(centralDirectoryOffset, centralDirectoryBytes);
  const centralView = view(central);

  const entries: ZipEntry[] = [];
  const seenPaths = new Set<string>();
  let directoryEntryCount = 0;
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;
  let cursor = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + CENTRAL_FILE_HEADER_BYTES > central.length) {
      throw new ArchiveIntakeError(
        "not-an-archive",
        "The archive's directory is truncated.",
      );
    }
    if (centralView.getUint32(cursor, true) !== CENTRAL_FILE_HEADER_SIGNATURE) {
      throw new ArchiveIntakeError(
        "not-an-archive",
        "The archive's directory is corrupt.",
      );
    }

    const madeByHost = centralView.getUint8(cursor + 5);
    const flags = centralView.getUint16(cursor + 8, true);
    const method = centralView.getUint16(cursor + 10, true);
    const declaredCrc32 = centralView.getUint32(cursor + 16, true);
    let compressedBytes = centralView.getUint32(cursor + 20, true);
    let uncompressedBytes = centralView.getUint32(cursor + 24, true);
    const nameBytes = centralView.getUint16(cursor + 28, true);
    const extraBytes = centralView.getUint16(cursor + 30, true);
    const commentBytes = centralView.getUint16(cursor + 32, true);
    const diskStart = centralView.getUint16(cursor + 34, true);
    const externalAttributes = centralView.getUint32(cursor + 38, true);
    let localHeaderOffset = centralView.getUint32(cursor + 42, true);

    const nameStart = cursor + CENTRAL_FILE_HEADER_BYTES;
    const extraStart = nameStart + nameBytes;
    const nextCursor = extraStart + extraBytes + commentBytes;
    if (nextCursor > central.length) {
      throw new ArchiveIntakeError(
        "not-an-archive",
        "The archive's directory is truncated.",
      );
    }

    const zip64 = readZip64Extra(central.subarray(extraStart, extraStart + extraBytes), {
      uncompressed: uncompressedBytes === 0xffffffff,
      compressed: compressedBytes === 0xffffffff,
      localOffset: localHeaderOffset === 0xffffffff,
    });
    uncompressedBytes = zip64.uncompressed ?? uncompressedBytes;
    compressedBytes = zip64.compressed ?? compressedBytes;
    localHeaderOffset = zip64.localOffset ?? localHeaderOffset;

    if (diskStart !== 0 && diskStart !== 0xffff) {
      throw new ArchiveIntakeError(
        "unsupported-zip-feature",
        "Split or multi-disk archives are not supported.",
      );
    }

    const rawName = decodeArchiveEntryName(
      central.subarray(nameStart, nameStart + nameBytes),
    );
    if (rawName === null) {
      throw new ArchiveIntakeError(
        "unsafe-entry-path",
        "The archive contains an entry path that is not valid UTF-8.",
      );
    }

    const pathCheck = checkArchiveEntryPath(rawName);
    if (!pathCheck.ok) {
      throw new ArchiveIntakeError("unsafe-entry-path", pathCheck.reason);
    }
    const { path, isDirectory } = pathCheck;

    // Case-insensitive too: iOS and Android storage will happily let one entry
    // overwrite another that differs only in case.
    const collisionKey = path.toLowerCase();
    if (seenPaths.has(collisionKey)) {
      throw new ArchiveIntakeError(
        "duplicate-entry",
        `The archive contains more than one entry for ${path}.`,
      );
    }
    seenPaths.add(collisionKey);

    assertSupportedEntry(
      path,
      isDirectory,
      flags,
      method,
      madeByHost,
      externalAttributes,
    );

    if (isDirectory) {
      directoryEntryCount += 1;
      cursor = nextCursor;
      continue;
    }

    if (method === STORED && compressedBytes !== uncompressedBytes) {
      throw new ArchiveIntakeError(
        "size-mismatch",
        `The archive declares inconsistent sizes for ${path}.`,
      );
    }
    if (localHeaderOffset + LOCAL_FILE_HEADER_BYTES > reader.byteLength) {
      throw new ArchiveIntakeError(
        "not-an-archive",
        `The archive places ${path} outside the file.`,
      );
    }

    entries.push({
      path,
      method,
      compressedBytes,
      uncompressedBytes,
      crc32: declaredCrc32,
      localHeaderOffset,
    });
    totalCompressedBytes += compressedBytes;
    totalUncompressedBytes += uncompressedBytes;
    cursor = nextCursor;
  }

  if (cursor !== central.length) {
    throw new ArchiveIntakeError(
      "not-an-archive",
      "The archive's directory has unexpected trailing data.",
    );
  }

  return {
    entries,
    directoryEntryCount,
    totalCompressedBytes,
    totalUncompressedBytes,
  };
}

export type StreamedZipEntry = {
  bytes: number;
  sha256: string;
};

/**
 * Stream one entry, verifying it as the bytes go by.
 *
 * `onBytes` sees each decompressed chunk exactly once. The entry is aborted
 * the instant it produces more than it declared, so the caller never has to
 * decide what to do with a half-written bomb.
 */
export async function streamZipEntry(
  reader: ArchiveByteReader,
  entry: ZipEntry,
  options: {
    createDecompressor: CreateDecompressor;
    createHasher: CreateHasher;
    onBytes: (bytes: Uint8Array) => void;
  },
): Promise<StreamedZipEntry> {
  const header = view(
    await reader.read(entry.localHeaderOffset, LOCAL_FILE_HEADER_BYTES),
  );
  if (header.getUint32(0, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new ArchiveIntakeError(
      "corrupt-archive",
      `The archive's directory does not match its contents for ${entry.path}.`,
    );
  }
  if (header.getUint16(8, true) !== entry.method) {
    throw new ArchiveIntakeError(
      "corrupt-archive",
      `The archive's directory does not match its contents for ${entry.path}.`,
    );
  }

  const nameBytes = header.getUint16(26, true);
  const extraBytes = header.getUint16(28, true);
  const localName = decodeArchiveEntryName(
    await reader.read(entry.localHeaderOffset + LOCAL_FILE_HEADER_BYTES, nameBytes),
  );
  if (localName !== entry.path) {
    throw new ArchiveIntakeError(
      "corrupt-archive",
      `The archive's directory does not match its contents for ${entry.path}.`,
    );
  }

  const dataStart =
    entry.localHeaderOffset + LOCAL_FILE_HEADER_BYTES + nameBytes + extraBytes;
  if (dataStart + entry.compressedBytes > reader.byteLength) {
    throw new ArchiveIntakeError(
      "corrupt-archive",
      `The archive is truncated before the end of ${entry.path}.`,
    );
  }

  const hasher = options.createHasher();
  const checksum = new Crc32();
  let written = 0;

  const accept = (bytes: Uint8Array): void => {
    written += bytes.length;
    if (written > entry.uncompressedBytes) {
      throw new ArchiveIntakeError(
        "size-mismatch",
        `${entry.path} expands past the size the archive declares for it.`,
      );
    }
    hasher.update(bytes);
    checksum.update(bytes);
    options.onBytes(bytes);
  };

  const decompressor =
    entry.method === STORED
      ? { push: (chunk: Uint8Array) => accept(chunk) }
      : options.createDecompressor(accept);

  let consumed = 0;
  while (consumed < entry.compressedBytes) {
    const length = Math.min(READ_CHUNK_BYTES, entry.compressedBytes - consumed);
    const chunk = await reader.read(dataStart + consumed, length);
    if (chunk.length !== length) {
      throw new ArchiveIntakeError(
        "corrupt-archive",
        `The archive is truncated before the end of ${entry.path}.`,
      );
    }
    consumed += length;
    decompressor.push(chunk, consumed === entry.compressedBytes);
  }
  if (entry.compressedBytes === 0) {
    decompressor.push(new Uint8Array(0), true);
  }

  if (written !== entry.uncompressedBytes) {
    throw new ArchiveIntakeError(
      "size-mismatch",
      `${entry.path} is not the size the archive declares for it.`,
    );
  }
  if (checksum.value() !== entry.crc32) {
    throw new ArchiveIntakeError(
      "corrupt-archive",
      `${entry.path} is corrupt.`,
    );
  }

  return { bytes: written, sha256: hasher.digestHex() };
}

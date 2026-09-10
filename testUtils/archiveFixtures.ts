/**
 * Builders for Cyd Bluesky archive intake tests.
 *
 * `buildZip` writes ZIP structures by hand so tests can produce the archives a
 * hostile or broken writer would produce — traversal paths, symlink entries,
 * duplicate names, lying sizes, forged manifests — which no real ZIP library
 * will emit. The in-memory environment records every byte that intake writes,
 * so tests can assert that nothing lands outside the staging area.
 */

import crypto from "crypto";
import zlib from "zlib";

import { crc32 } from "@/services/archive-import/crc32";
import { checkZipEntryPath } from "@/services/archive-import/entry-paths";
import type {
  BlueskyArchiveByteReader,
  BlueskyArchiveIntakeEnvironment,
  BlueskyArchiveStagingArea,
  CreateHasher,
  Hasher,
  StagedFileWriter,
} from "@/services/archive-import/ports";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

export type ZipEntryInput = {
  name: string;
  data?: Uint8Array | string;
  /** 0 = stored, 8 = deflate. Defaults to deflate. */
  method?: 0 | 8;
  /** Overrides the CRC recorded in the headers. */
  crc32?: number;
  /** Overrides the compressed size recorded in the central directory. */
  compressedBytes?: number;
  /** Overrides the uncompressed size recorded in the central directory. */
  uncompressedBytes?: number;
  externalAttributes?: number;
  /** Upper byte of "version made by". 3 is Unix. */
  versionMadeByHost?: number;
  generalPurposeFlags?: number;
  /** Writes a different name into the local header than the central one. */
  localName?: string;
};

export function toBytes(value: Uint8Array | string): Uint8Array {
  return typeof value === "string" ? new TextEncoder().encode(value) : value;
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  length = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  pushUint16(value: number): void {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    this.push(bytes);
  }

  pushUint32(value: number): void {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    this.push(bytes);
  }

  toUint8Array(): Uint8Array {
    const result = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}

export function buildZip(
  entries: ZipEntryInput[],
  options: { entryCount?: number; comment?: string } = {},
): Uint8Array {
  const output = new ByteWriter();
  const central = new ByteWriter();
  const nameEncoder = new TextEncoder();

  for (const entry of entries) {
    const raw = toBytes(entry.data ?? new Uint8Array(0));
    const method = entry.method ?? 8;
    const compressed =
      method === 0 ? raw : new Uint8Array(zlib.deflateRawSync(raw, { level: 9 }));
    const flags = entry.generalPurposeFlags ?? 0x0800;
    const checksum = entry.crc32 ?? crc32(raw);
    const compressedBytes = entry.compressedBytes ?? compressed.length;
    const uncompressedBytes = entry.uncompressedBytes ?? raw.length;
    const centralName = nameEncoder.encode(entry.name);
    const localName = nameEncoder.encode(entry.localName ?? entry.name);
    const localHeaderOffset = output.length;

    output.pushUint32(LOCAL_FILE_HEADER_SIGNATURE);
    output.pushUint16(20);
    output.pushUint16(flags);
    output.pushUint16(method);
    output.pushUint16(0);
    output.pushUint16(0);
    output.pushUint32(checksum);
    output.pushUint32(compressedBytes);
    output.pushUint32(uncompressedBytes);
    output.pushUint16(localName.length);
    output.pushUint16(0);
    output.push(localName);
    output.push(compressed);

    central.pushUint32(CENTRAL_FILE_HEADER_SIGNATURE);
    central.pushUint16(((entry.versionMadeByHost ?? 3) << 8) | 20);
    central.pushUint16(20);
    central.pushUint16(flags);
    central.pushUint16(method);
    central.pushUint16(0);
    central.pushUint16(0);
    central.pushUint32(checksum);
    central.pushUint32(compressedBytes);
    central.pushUint32(uncompressedBytes);
    central.pushUint16(centralName.length);
    central.pushUint16(0);
    central.pushUint16(0);
    central.pushUint16(0);
    central.pushUint16(0);
    central.pushUint32(
      entry.externalAttributes ??
        (entry.name.endsWith("/") ? (0x41ed << 16) | 0x10 : 0x81a4 << 16),
    );
    central.pushUint32(localHeaderOffset);
    central.push(centralName);
  }

  const centralDirectoryOffset = output.length;
  const centralBytes = central.toUint8Array();
  output.push(centralBytes);

  const comment = nameEncoder.encode(options.comment ?? "");
  const entryCount = options.entryCount ?? entries.length;
  output.pushUint32(END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  output.pushUint16(0);
  output.pushUint16(0);
  output.pushUint16(entryCount);
  output.pushUint16(entryCount);
  output.pushUint32(centralBytes.length);
  output.pushUint32(centralDirectoryOffset);
  output.pushUint16(comment.length);
  output.push(comment);

  return output.toUint8Array();
}

export type ArchivePayloadInput = {
  path: string;
  data: Uint8Array | string;
};

export const CANONICAL_ARCHIVE_METADATA = {
  format: "cyd-archive",
  platform: "bluesky",
  version: 2,
  createdAt: "2026-01-15T12:00:00.000Z",
  accountDid: "did:plc:canonicalalice",
  accountUuid: "018d5f7a-9b3c-7d10-8a2e-1f4c6b8d0e12",
  completeness: "complete",
} as const;

export type BlueskyArchiveInput = {
  /** Replaces metadata.json wholesale. An object is serialized for you. */
  metadata?: Record<string, unknown> | string;
  /** Payloads besides metadata.json; defaults to a stand-in data.db. */
  payloads?: ArchivePayloadInput[];
  /** Rewrites the manifest after it is generated, to forge or corrupt it. */
  manifest?: (manifest: {
    algorithm: string;
    payloads: { path: string; bytes: number; sha256: string }[];
  }) => unknown;
  /** Entries appended to the ZIP without being listed in the manifest. */
  unlistedEntries?: ZipEntryInput[];
  /** Applied to the generated entries, for example to corrupt one. */
  mutateEntries?: (entries: ZipEntryInput[]) => ZipEntryInput[];
};

/**
 * Build a version 2 Cyd Bluesky archive: metadata.json, manifest.json, and
 * the payloads, laid out the way the canonical contract fixtures are.
 */
export function buildBlueskyArchive(input: BlueskyArchiveInput = {}): Uint8Array {
  const metadata =
    typeof input.metadata === "string"
      ? input.metadata
      : JSON.stringify(input.metadata ?? CANONICAL_ARCHIVE_METADATA);
  const payloads: ArchivePayloadInput[] = [
    { path: "metadata.json", data: metadata },
    ...(input.payloads ?? [{ path: "data.db", data: "SQLite format 3\u0000stand-in" }]),
  ];

  const manifest = {
    algorithm: "sha256",
    payloads: [...payloads]
      .sort((left, right) => (left.path < right.path ? -1 : 1))
      .map((payload) => ({
        path: payload.path,
        bytes: toBytes(payload.data).length,
        sha256: sha256Hex(payload.data),
      })),
  };

  let entries: ZipEntryInput[] = [
    ...payloads.map((payload) => ({ name: payload.path, data: payload.data })),
    {
      name: "manifest.json",
      data: JSON.stringify(input.manifest ? input.manifest(manifest) : manifest),
    },
    ...(input.unlistedEntries ?? []),
  ];
  if (input.mutateEntries) {
    entries = input.mutateEntries(entries);
  }

  return buildZip(entries);
}

export function sha256Hex(data: Uint8Array | string): string {
  return crypto.createHash("sha256").update(Buffer.from(toBytes(data))).digest("hex");
}

export const createNodeHasher: CreateHasher = (): Hasher => {
  const hash = crypto.createHash("sha256");
  return {
    update: (chunk) => {
      hash.update(Buffer.from(chunk));
    },
    digestHex: () => hash.digest("hex"),
  };
};

export type MemoryByteReaderOptions = {
  /** Throw on the nth read, standing in for the process going away. */
  failOnRead?: number;
};

export function createMemoryByteReader(
  bytes: Uint8Array,
  options: MemoryByteReaderOptions = {},
): BlueskyArchiveByteReader & { readCount: number; closed: boolean } {
  const reader = {
    byteLength: bytes.length,
    readCount: 0,
    closed: false,
    async read(offset: number, length: number): Promise<Uint8Array> {
      reader.readCount += 1;
      if (options.failOnRead !== undefined && reader.readCount === options.failOnRead) {
        throw new Error("Simulated storage failure");
      }
      return bytes.slice(offset, offset + length);
    },
    close(): void {
      reader.closed = true;
    },
  };
  return reader;
}

export class MemoryStagingArea implements BlueskyArchiveStagingArea {
  readonly root: string;
  readonly files = new Map<string, Uint8Array>();
  /** Staging-relative paths whose writes should fail, standing in for a crash. */
  readonly failWrites = new Set<string>();
  destroyed = false;

  constructor(intakeId: string) {
    this.root = `memory://staging/${intakeId}/`;
  }

  /**
   * Fails loudly rather than as a rejection: a harness that reached outside its
   * own staging area is a bug in the test, not an archive Cyd should refuse.
   */
  private assertRelative(relativePath: string): void {
    const check = checkZipEntryPath(relativePath);
    if (!check.ok || check.isDirectory) {
      throw new Error(
        `Test staging area asked to touch ${relativePath}, which is not a file inside it.`,
      );
    }
  }

  createFile(relativePath: string): StagedFileWriter {
    this.assertRelative(relativePath);
    const chunks: Uint8Array[] = [];
    let length = 0;
    // Mirrors real storage: the file exists, empty, as soon as it is created.
    this.files.set(relativePath, new Uint8Array(0));
    return {
      write: (chunk) => {
        if (this.failWrites.has(relativePath)) {
          throw new Error(`Simulated storage failure writing ${relativePath}`);
        }
        chunks.push(chunk.slice());
        length += chunk.length;
        const partial = new Uint8Array(length);
        let offset = 0;
        for (const written of chunks) {
          partial.set(written, offset);
          offset += written.length;
        }
        this.files.set(relativePath, partial);
      },
      close: () => {},
    };
  }

  fileExists(relativePath: string): boolean {
    return this.files.has(relativePath);
  }

  fileSize(relativePath: string): number | null {
    return this.files.get(relativePath)?.length ?? null;
  }

  readText(relativePath: string): string | null {
    const bytes = this.files.get(relativePath);
    return bytes === undefined ? null : new TextDecoder().decode(bytes);
  }

  writeText(relativePath: string, contents: string): void {
    this.assertRelative(relativePath);
    this.files.set(relativePath, new TextEncoder().encode(contents));
  }

  destroy(): void {
    this.files.clear();
    this.destroyed = true;
  }
}

export type TestBlueskyArchiveIntakeEnvironment = Omit<
  BlueskyArchiveIntakeEnvironment,
  "openStaging"
> & {
  openStaging(intakeId: string): MemoryStagingArea;
  stagingAreas: Map<string, MemoryStagingArea>;
  availableStorage: number;
};

export function createTestBlueskyArchiveIntakeEnvironment(
  options: { availableStorageBytes?: number } = {},
): TestBlueskyArchiveIntakeEnvironment {
  const stagingAreas = new Map<string, MemoryStagingArea>();
  // Required lazily so that a test file mocking expo-file-system does not have
  // to care about the module graph behind the decompressor.
  const { createInflateDecompressor } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@/services/archive-import/inflate") as typeof import("@/services/archive-import/inflate");

  const environment: TestBlueskyArchiveIntakeEnvironment = {
    stagingAreas,
    availableStorage: options.availableStorageBytes ?? 8 * 1024 * 1024 * 1024,
    openStaging(intakeId: string): MemoryStagingArea {
      const existing = stagingAreas.get(intakeId);
      if (existing && !existing.destroyed) {
        return existing;
      }
      const created = new MemoryStagingArea(intakeId);
      stagingAreas.set(intakeId, created);
      return created;
    },
    listStagingIds: () =>
      [...stagingAreas.entries()]
        .filter(([, area]) => !area.destroyed)
        .map(([intakeId]) => intakeId),
    availableStorageBytes: () => environment.availableStorage,
    createHasher: createNodeHasher,
    createDecompressor: createInflateDecompressor,
    now: () => new Date("2026-09-10T00:00:00.000Z"),
  };
  return environment;
}

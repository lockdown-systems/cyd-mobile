import { Deflate } from "fflate";

import { Crc32 } from "@/services/archive-import/crc32";

import type { BlueskyArchiveExportEnvironment, ExportStagingArea } from "./ports";

/**
 * Compressing the Bluesky interchange database on its way into the archive.
 *
 * Media is left stored — JPEG and MP4 do not compress — but `data.db` is
 * mostly empty SQLite pages and text, and shrinks by around thirty times. On a
 * committed fixture that is the difference between 4 KiB and 144 KiB, and
 * committed bytes live in repository history forever.
 *
 * Compression happens into a second staged file rather than in memory, for the
 * same reason the ZIP writer stores everything else: an entry's compressed size
 * has to be known before its header is written, and a phone must not have to
 * hold a whole account database to find that out.
 */

export type CompressedStagedFile = {
  /** Size and checksum of the original, which is what the ZIP header records. */
  byteLength: number;
  crc32: number;
  sha256: string;
  compressedByteLength: number;
  /** Staging-relative path of the compressed copy. */
  compressedPath: string;
};

export async function compressStagedFile(
  environment: BlueskyArchiveExportEnvironment,
  staging: ExportStagingArea,
  sourcePath: string,
  compressedPath: string,
): Promise<CompressedStagedFile> {
  const output = staging.createFile(compressedPath);
  const hasher = environment.createHasher();
  const checksum = new Crc32();
  let byteLength = 0;
  let compressedByteLength = 0;

  const deflate = new Deflate((chunk) => {
    if (chunk.length > 0) {
      output.write(chunk);
      compressedByteLength += chunk.length;
    }
  });

  try {
    await environment.readFile(staging.locate(sourcePath), (bytes) => {
      hasher.update(bytes);
      checksum.update(bytes);
      byteLength += bytes.length;
      deflate.push(bytes, false);
    });
    deflate.push(new Uint8Array(0), true);
  } finally {
    output.close();
  }

  return {
    byteLength,
    crc32: checksum.value(),
    sha256: hasher.digestHex(),
    compressedByteLength,
    compressedPath,
  };
}

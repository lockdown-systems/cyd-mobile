import { Crc32 } from "@/services/archive-import/crc32";

import type { BlueskyArchiveExportEnvironment } from "./ports";

/**
 * Deciding what Cyd can honestly claim about each preserved asset.
 *
 * A Cyd Bluesky archive is allowed to be incomplete; it is not allowed to be
 * quietly wrong. So every asset the account references ends up in one of three
 * states, and none of them is "left out":
 *
 * - `available` — the bytes were read and hashed, and go in the archive.
 * - `missing` — Cyd never finished preserving it, so there is nothing to
 *   package. The record still references it, and the archive is incomplete.
 * - `unavailable` — Cyd had preserved it, but it was gone or a different size
 *   by the time the export read it. This is the case the point-in-time
 *   inventory exists to catch (ADR 0010).
 *
 * Hashing happens after account work resumes, which is exactly why it can
 * disagree with the inventory. That disagreement is information, so it is
 * recorded rather than retried into silence.
 *
 * The reasons are written for whoever opens the archive, and are fixed strings
 * on purpose: a storage error's own message names the file it failed on, and
 * device filesystem paths are one of the things the contract's privacy
 * boundary keeps out of a Cyd Bluesky archive.
 */

/** Identifies a preserved file within one export, before it is hashed. */
export type StagedAsset = {
  key: string;
  localPath: string | null;
  /** Cyd's own record of whether it finished preserving the file. */
  preserved: boolean;
  /** Size when the inventory was taken, or null if the file was not there. */
  stagedByteLength: number | null;
};

export type ResolvedAsset =
  | {
      key: string;
      availability: "available";
      sha256: string;
      byteCount: number;
      crc32: number;
      /** What the bytes turned out to be, when Cyd never recorded a type. */
      sniffedMediaType: string | null;
      archivePath: string;
      localPath: string;
    }
  | {
      key: string;
      availability: "missing" | "unavailable";
      reason: string;
    };

/** How a link preview's preserved thumbnail is named in the inventory. */
export function previewAssetKey(postUri: string): string {
  return `preview:${postUri}`;
}

/** Content-addressed location of an asset inside a Cyd Bluesky archive. */
export function archivePathForDigest(sha256: string): string {
  return `media/sha256/${sha256.slice(0, 2)}/${sha256}`;
}

function unresolved(
  key: string,
  availability: "missing" | "unavailable",
  reason: string,
): ResolvedAsset {
  return { key, availability, reason };
}

const MAGIC_NUMBERS: { prefix: number[]; mediaType: string }[] = [
  { prefix: [0xff, 0xd8, 0xff], mediaType: "image/jpeg" },
  { prefix: [0x89, 0x50, 0x4e, 0x47], mediaType: "image/png" },
  { prefix: [0x47, 0x49, 0x46, 0x38], mediaType: "image/gif" },
];

/**
 * Name a file's type from its own first bytes.
 *
 * `assets.media_type` is required, and Cyd does not record a MIME type for
 * every preserved file — link preview thumbnails have none at all. Reading it
 * off the bytes beats defaulting to whatever is most common.
 */
export function sniffMediaType(head: Uint8Array): string | null {
  for (const candidate of MAGIC_NUMBERS) {
    if (candidate.prefix.every((byte, index) => head[index] === byte)) {
      return candidate.mediaType;
    }
  }
  // ISO base media format (MP4 and friends): "ftyp" at offset 4.
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) {
    return "video/mp4";
  }
  return null;
}

/**
 * Read and hash every inventoried asset, one at a time.
 *
 * One file is in memory at most: assets are streamed through the hasher, so a
 * long video costs the same as a thumbnail.
 */
export async function resolveStagedAssets(
  environment: BlueskyArchiveExportEnvironment,
  inventory: StagedAsset[],
): Promise<Map<string, ResolvedAsset>> {
  const resolved = new Map<string, ResolvedAsset>();

  for (const asset of inventory) {
    resolved.set(asset.key, await resolveOne(environment, asset));
  }

  return resolved;
}

async function resolveOne(
  environment: BlueskyArchiveExportEnvironment,
  asset: StagedAsset,
): Promise<ResolvedAsset> {
  if (!asset.preserved) {
    return unresolved(
      asset.key,
      "missing",
      "Cyd has not finished preserving this file, so it could not be included.",
    );
  }
  if (!asset.localPath) {
    return unresolved(
      asset.key,
      "missing",
      "Cyd has no local copy of this file.",
    );
  }
  if (asset.stagedByteLength === null) {
    return unresolved(
      asset.key,
      "unavailable",
      "The preserved file was no longer on this device when the export was staged.",
    );
  }

  const hasher = environment.createHasher();
  const checksum = new Crc32();
  let byteCount = 0;
  let head: Uint8Array | null = null;
  try {
    await environment.readFile(asset.localPath, (bytes) => {
      if (head === null) {
        head = bytes.slice(0, 12);
      }
      hasher.update(bytes);
      checksum.update(bytes);
      byteCount += bytes.length;
    });
  } catch {
    // The error's own message is discarded rather than reported: it names the
    // device path it failed to open, which must not reach the archive.
    return unresolved(
      asset.key,
      "unavailable",
      "The preserved file could not be read while the export was being packaged.",
    );
  }

  if (byteCount !== asset.stagedByteLength) {
    return unresolved(
      asset.key,
      "unavailable",
      "The preserved file changed while the export was being prepared.",
    );
  }

  const sha256 = hasher.digestHex();
  return {
    key: asset.key,
    availability: "available",
    sha256,
    byteCount,
    crc32: checksum.value(),
    sniffedMediaType: head === null ? null : sniffMediaType(head),
    archivePath: archivePathForDigest(sha256),
    localPath: asset.localPath,
  };
}

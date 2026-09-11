import type { InterchangeAsset } from "./interchange-reader";
import type { RestoredAssetPlacement } from "./mobile-rows";
import type { PreparedArchiveStore, StoredMediaFile } from "./ports";

/**
 * Copying a Cyd Bluesky archive's packaged assets into a Bluesky local
 * account.
 *
 * Both halves of an import land here: a restore copies into the account it is
 * creating, and a merge copies into the account it is merging with (#97). The
 * rule is the same either way, which is why it is one file — an archive's
 * media is content-addressed, so the same bytes referenced by several records
 * are stored once (ADR 0007).
 */

/** Content-addressed name of a restored file inside the account's media store. */
export function restoredMediaFileName(sha256: string): string {
  return `sha256-${sha256}`;
}

/**
 * What an asset the archive cannot supply looks like, wherever it is noticed.
 *
 * A merge works this out before it copies anything, so that somebody can be
 * shown the rows it would write; a restore works it out as it copies. Both
 * have to reach the same answer, so they ask the same function.
 */
function missingPlacement(asset: InterchangeAsset): RestoredAssetPlacement {
  return {
    assetId: asset.id,
    availability: "missing",
    reason:
      asset.unavailable_reason ?? "This file was not included in the archive.",
  };
}

/** Whether the archive claims to carry this file's bytes at all. */
function isPackaged(
  asset: InterchangeAsset,
): asset is InterchangeAsset & { archive_path: string; sha256: string } {
  return (
    asset.availability === "available" &&
    asset.archive_path !== null &&
    asset.sha256 !== null
  );
}

/**
 * Where each packaged asset will end up, without moving a byte.
 *
 * Media is content-addressed, so its path is a fact about the file rather than
 * a result of copying it. That is what lets a merge plan the exact rows it
 * would write before anybody has agreed to the merge (ADR 0018).
 */
export function predictArchivedMedia(
  assets: InterchangeAsset[],
  mediaUriFor: (fileName: string) => string,
): Map<string, RestoredAssetPlacement> {
  const placements = new Map<string, RestoredAssetPlacement>();
  for (const asset of assets) {
    placements.set(
      asset.id,
      isPackaged(asset)
        ? {
            assetId: asset.id,
            availability: "restored",
            localPath: mediaUriFor(restoredMediaFileName(asset.sha256)),
          }
        : missingPlacement(asset),
    );
  }
  return placements;
}

/** The one capability placing media needs, out of the larger environments. */
export type MediaStore = {
  storeAccountMedia(
    accountUuid: string,
    fileName: string,
    write: (push: (bytes: Uint8Array) => void) => Promise<void>,
  ): Promise<StoredMediaFile>;
};

/**
 * Copy each packaged asset into the Bluesky local account, once per file.
 *
 * An asset the archive marked unavailable never had bytes to copy. One that
 * will not read, or that arrives the wrong size, is treated the same way: the
 * archive's promise about that file did not hold, and calling it restored
 * would make an incomplete backup look complete. Either way the record keeps
 * its reference and the source URL, so saving can fetch it later.
 */
export async function placeArchivedMedia(
  environment: MediaStore,
  options: {
    accountUuid: string;
    archive: Pick<PreparedArchiveStore, "readPayload">;
    assets: InterchangeAsset[];
    onPlaced: (placed: number) => void;
  },
): Promise<Map<string, RestoredAssetPlacement>> {
  const placements = new Map<string, RestoredAssetPlacement>();
  const byDigest = new Map<string, string>();
  let placed = 0;

  for (const asset of options.assets) {
    if (!isPackaged(asset)) {
      placements.set(asset.id, missingPlacement(asset));
      continue;
    }

    const alreadyPlaced = byDigest.get(asset.sha256);
    if (alreadyPlaced) {
      placements.set(asset.id, {
        assetId: asset.id,
        availability: "restored",
        localPath: alreadyPlaced,
      });
      continue;
    }

    const archivePath = asset.archive_path;
    let stored: StoredMediaFile | null = null;
    try {
      stored = await environment.storeAccountMedia(
        options.accountUuid,
        restoredMediaFileName(asset.sha256),
        (push) => options.archive.readPayload(archivePath, push),
      );
    } catch {
      stored = null;
    }

    const wrongSize =
      stored !== null &&
      asset.byte_count !== null &&
      stored.byteLength !== asset.byte_count;
    if (stored === null || wrongSize) {
      placements.set(asset.id, {
        assetId: asset.id,
        availability: "missing",
        reason: "Cyd could not restore this file from the archive.",
      });
      continue;
    }

    byDigest.set(asset.sha256, stored.uri);
    placements.set(asset.id, {
      assetId: asset.id,
      availability: "restored",
      localPath: stored.uri,
    });
    placed += 1;
    options.onPlaced(placed);
  }

  return placements;
}

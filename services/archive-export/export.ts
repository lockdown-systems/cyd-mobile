import {
  classifyBlueskyArchiveMetadata,
  type BlueskyArchiveMetadata,
} from "@/services/archive-metadata";
import { Crc32 } from "@/services/archive-import/crc32";
import {
  DATABASE_ENTRY_PATH,
  MANIFEST_ENTRY_PATH,
  METADATA_ENTRY_PATH,
  type BlueskyArchiveManifestPayload,
} from "@/services/archive-import/manifest";

import {
  assetChangedWhilePrepared,
  resolveStagedAssets,
  type ResolvedAsset,
} from "./assets";
import {
  checkpointMatches,
  readExportCheckpoint,
  writeExportCheckpoint,
  type BlueskyArchiveExportCheckpoint,
  type BlueskyArchiveExportPhase,
} from "./checkpoint";
import { writeBlueskyInterchangeDatabase } from "./database-writer";
import { compressStagedFile } from "./deflate";
import {
  BlueskyArchiveExportCancelled,
  BlueskyArchiveExportError,
} from "./errors";
import {
  translateBlueskyAccountToInterchange,
  type AssetRow,
  type BlueskyInterchangeContent,
  type PortableSettings,
} from "./interchange";
import { readMobileAccountSnapshot } from "./mobile-snapshot";
import type {
  BlueskyArchiveExportEnvironment,
  ExportStagingArea,
} from "./ports";
import { stageBlueskyAccountSnapshot } from "./snapshot";
import { BlueskyArchiveZipWriter } from "./zip-writer";

/**
 * Writing one Bluesky local account out as a Cyd Bluesky archive.
 *
 * The order of the four steps is the whole design:
 *
 * 1. **Stage** — pause account work, copy the database, inventory the media.
 *    This is the point in time the archive describes (ADR 0010).
 * 2. **Hash** — with saving running again, read every inventoried file. What
 *    disagrees with the inventory becomes an unavailable asset, not a lie.
 * 3. **Translate** — turn Mobile's private rows into the interchange model and
 *    build `data.db` in staging (ADR 0002).
 * 4. **Package** — stream media, database, metadata, and manifest into the ZIP.
 *
 * Nothing here reads the live account after step 1, so however long steps 2–4
 * take, the archive stays internally consistent.
 *
 * Steps 1 and 2 are checkpointed, because they are the two an export cannot
 * afford to repeat: step 1 fixes the moment the archive describes, and step 2
 * reads every preserved byte on the device. An export the operating system
 * kills is therefore picked up where it stopped rather than started over, and
 * it comes back as the same export — same moment, same digests (ADR 0006).
 * Steps 3 and 4 are rebuilt from the staged snapshot each attempt, which is
 * cheap and leaves no half-written archive to mistake for a finished one.
 *
 * Staging is thrown away the moment it stops being useful: by the caller once
 * the archive has been handed over, and here when somebody cancels or when a
 * failure is one that will happen again. What survives is only what a later
 * launch can carry on from.
 *
 * Building this writer is not the same as offering it to people: until #100
 * proves conformance both ways, export stays behind a development-only
 * affordance (ADR 0004).
 */

const BLUESKY_INTERCHANGE_PATH = "data.db";

/** How many hashed files to settle before writing the checkpoint again. */
const ASSETS_PER_CHECKPOINT = 25;
const COMPRESSED_INTERCHANGE_PATH = "data.db.deflate";

export type { BlueskyArchiveExportPhase };

export type BlueskyArchiveExportProgress = {
  phase: BlueskyArchiveExportPhase;
  packagedPayloads: number;
  totalPayloads: number;
  /** Preserved files read and hashed, of the ones the snapshot inventoried. */
  hashedAssets: number;
  totalAssets: number;
  /** Whether this run picked up work an interrupted one had already done. */
  resumed: boolean;
};

export type BlueskyArchiveExportRequest = {
  /** Stable id for this export; names its staging directory. */
  exportId: string;
  accountUuid: string;
  accountDid: string;
  accountHandle?: string | null;
  /**
   * Save and delete defaults to carry as portable settings.
   *
   * Passed in rather than read here, because they live in Cyd's main database
   * alongside credentials and schedules. Only the caller's chosen booleans
   * cross this boundary.
   */
  portableSettings: PortableSettings;
  /** Suggested filename. The format never treats a filename as authoritative. */
  fileName?: string;
  /**
   * Asked between files, so walking away stops the reading rather than only
   * what it reports. A cancelled export takes its staging with it.
   */
  shouldCancel?: () => boolean;
  onProgress?: (progress: BlueskyArchiveExportProgress) => void;
};

export type BlueskyArchiveAssetSummary = {
  total: number;
  available: number;
  missing: number;
  unavailable: number;
};

export type BlueskyArchiveExportResult = {
  exportId: string;
  /** Where the finished archive is, inside the export's staging area. */
  location: string;
  fileName: string;
  byteLength: number;
  metadata: BlueskyArchiveMetadata;
  assets: BlueskyArchiveAssetSummary;
  /**
   * The staging area holding the archive.
   *
   * The archive is still in staging when this returns, because the caller has
   * not handed it over yet, and only the caller knows when it has. Discarding
   * it is therefore the caller's last step — see `discardBlueskyArchiveExport`.
   * The other two endings are taken here: a cancelled export and a failure Cyd
   * can name both clear their own staging on the way out.
   */
  staging: ExportStagingArea;
};

function suggestFileName(request: BlueskyArchiveExportRequest, createdAt: Date): string {
  const subject = (request.accountHandle ?? request.accountDid).replace(
    /[^a-zA-Z0-9._-]/g,
    "-",
  );
  return `cyd-bluesky-${subject}-${createdAt.toISOString().slice(0, 10)}.cyd`;
}

export async function runBlueskyArchiveExport(
  environment: BlueskyArchiveExportEnvironment,
  request: BlueskyArchiveExportRequest,
): Promise<BlueskyArchiveExportResult> {
  let staging = environment.openStaging(request.exportId);
  let checkpoint = readExportCheckpoint(staging);
  if (checkpoint && !checkpointMatches(checkpoint, staging, request)) {
    // Staging that cannot be handed to this export is debris that happens to
    // share an id, and its snapshot describes somebody else's moment.
    staging.destroy();
    staging = environment.openStaging(request.exportId);
    checkpoint = null;
  }
  const resumed = checkpoint !== null;

  const report = (
    phase: BlueskyArchiveExportPhase,
    counts: {
      packagedPayloads?: number;
      totalPayloads?: number;
      hashed?: number;
      totalAssets?: number;
    } = {},
  ): void =>
    request.onProgress?.({
      phase,
      packagedPayloads: counts.packagedPayloads ?? 0,
      totalPayloads: counts.totalPayloads ?? 0,
      hashedAssets: counts.hashed ?? 0,
      totalAssets: counts.totalAssets ?? 0,
      resumed,
    });

  try {
    let staged =
      checkpoint ??
      (await (async () => {
        report("staging");
        const taken = await stageBlueskyAccountSnapshot(environment, staging);
        return writeExportCheckpoint(staging, environment, {
          accountUuid: request.accountUuid,
          accountDid: request.accountDid,
          accountHandle: request.accountHandle ?? null,
          phase: "hashing",
          takenAt: taken.takenAt.toISOString(),
          snapshotPath: taken.snapshotPath,
          inventory: taken.inventory,
          resolved: [],
          changed: [],
          fileName: request.fileName ?? null,
          result: null,
        });
      })());

    /** Record where the export has got to, keeping everything it already had. */
    const save = (
      fields: Partial<
        Omit<BlueskyArchiveExportCheckpoint, "version" | "updatedAt">
      >,
    ): BlueskyArchiveExportCheckpoint => {
      staged = writeExportCheckpoint(staging, environment, {
        ...staged,
        ...fields,
      });
      return staged;
    };

    const takenAt = new Date(staged.takenAt);
    const inventory = staged.inventory;

    // An export killed between packaging and handing over has the whole
    // archive sitting in staging. Rebuilding it would produce the same bytes
    // from the same snapshot, so the finished one is offered again instead.
    if (staged.phase === "done" && staged.result) {
      const finished = staged.result;
      if (staging.fileExists(finished.fileName)) {
        report("done", {
          hashed: staged.resolved.length,
          totalAssets: inventory.length,
        });
        return {
          exportId: request.exportId,
          location: staging.locate(finished.fileName),
          fileName: finished.fileName,
          byteLength: finished.byteLength,
          metadata: finished.metadata,
          assets: finished.assets,
          staging,
        };
      }
    }

    report("hashing", {
      hashed: staged.resolved.length,
      totalAssets: inventory.length,
    });
    let sinceCheckpoint = 0;
    const assets = await resolveStagedAssets(environment, inventory, {
      resolved: new Map(staged.resolved),
      changed: new Set(staged.changed),
      shouldCancel: request.shouldCancel,
      onResolved: (resolved) => {
        // The checkpoint carries every digest so far, so writing one per file
        // would rewrite the whole pass once per file — on an account with
        // thousands of preserved files, more bytes written than hashed. A
        // batch is the trade: an export killed mid-pass rereads at most this
        // many files, which is nothing beside rereading all of them.
        sinceCheckpoint += 1;
        if (
          sinceCheckpoint >= ASSETS_PER_CHECKPOINT ||
          resolved.size === inventory.length
        ) {
          sinceCheckpoint = 0;
          save({ phase: "hashing", resolved: [...resolved] });
        }
        report("hashing", {
          hashed: resolved.size,
          totalAssets: inventory.length,
        });
      },
    });

    const fileName =
      request.fileName ?? staged.fileName ?? suggestFileName(request, takenAt);
    save({ phase: "translating", fileName });

    // Translate and package in one loop, because packaging is the only pass
    // that can still find an asset hashing thought it had: a file that moved
    // since is demoted to unavailable and the archive is built again around
    // that, rather than an export failing over one file it can describe
    // honestly instead. Each attempt demotes at least one asset, so this ends.
    for (;;) {
      report("translating", { totalAssets: inventory.length, hashed: assets.size });
      const content = translateSnapshot(environment, staging, request, {
        snapshotPath: staged.snapshotPath,
        takenAt,
        assets,
      });

      save({ phase: "packaging" });
      report("packaging", { totalPayloads: content.payloads.length });
      try {
        const byteLength = await packageArchive(environment, staging, {
          archivePath: fileName,
          content,
          createdAt: takenAt,
          shouldCancel: request.shouldCancel,
          onPayloadPackaged: (packagedPayloads) =>
            report("packaging", {
              packagedPayloads,
              totalPayloads: content.payloads.length,
            }),
        });

        const finished = {
          fileName,
          byteLength,
          metadata: buildMetadata(content),
          assets: summarizeAssets(content),
        };
        save({ phase: "done", result: finished });
        report("done", {
          packagedPayloads: content.payloads.length,
          totalPayloads: content.payloads.length,
          hashed: assets.size,
          totalAssets: inventory.length,
        });
        return {
          exportId: request.exportId,
          location: staging.locate(fileName),
          ...finished,
          staging,
        };
      } catch (error) {
        const changed = changedAssetKeys(error, content, assets);
        if (changed.length === 0) {
          throw error;
        }
        for (const key of changed) {
          assets.set(key, assetChangedWhilePrepared(key));
        }
        save({
          changed: [...new Set([...staged.changed, ...changed])],
          resolved: [...assets],
        });
      }
    }
  } catch (error) {
    if (error instanceof BlueskyArchiveExportCancelled) {
      staging.destroy();
      throw error;
    }
    // A failure Cyd can name is one that would happen again, so there is
    // nothing worth keeping. Anything else — storage, memory, the system
    // taking the app away mid-write — leaves the checkpoint alone, and the
    // next launch carries on from it (ADR 0006).
    if (error instanceof BlueskyArchiveExportError) {
      staging.destroy();
    }
    throw error;
  }
}

/**
 * Build the interchange model and `data.db` from the staged snapshot.
 *
 * Deterministic in everything it reads: the snapshot cannot change, and the
 * assets are whatever hashing concluded. That is what makes it safe to run
 * again on a later launch, or again after a demoted asset.
 */
function translateSnapshot(
  environment: BlueskyArchiveExportEnvironment,
  staging: ExportStagingArea,
  request: BlueskyArchiveExportRequest,
  staged: {
    snapshotPath: string;
    takenAt: Date;
    assets: Map<string, ResolvedAsset>;
  },
): BlueskyInterchangeContent {
  const snapshotDatabase = environment.openSnapshot(staging, staged.snapshotPath);
  let content: BlueskyInterchangeContent;
  try {
    content = translateBlueskyAccountToInterchange(
      readMobileAccountSnapshot(snapshotDatabase),
      {
        accountDid: request.accountDid,
        accountUuid: request.accountUuid,
        createdAt: staged.takenAt,
        assets: staged.assets,
        portableSettings: request.portableSettings,
      },
    );
  } finally {
    snapshotDatabase.close();
  }

  const interchange = environment.createBlueskyInterchangeDatabase(
    staging,
    BLUESKY_INTERCHANGE_PATH,
  );
  try {
    writeBlueskyInterchangeDatabase(interchange, content);
  } finally {
    interchange.close();
  }
  return content;
}

/**
 * Which assets a packaging failure blames, if it blames any.
 *
 * The archive path names one content digest, and several records can share it,
 * so every asset key that hashed to it is demoted together — they are the same
 * file, and it moved.
 */
function changedAssetKeys(
  error: unknown,
  content: BlueskyInterchangeContent,
  assets: Map<string, ResolvedAsset>,
): string[] {
  if (
    !(error instanceof BlueskyArchiveExportError) ||
    error.code !== "asset-changed" ||
    !error.entryPath
  ) {
    return [];
  }
  const payload = content.payloads.find(
    (candidate) => candidate.archivePath === error.entryPath,
  );
  if (!payload) {
    return [];
  }
  return [...assets]
    .filter(
      ([, asset]) =>
        asset.availability === "available" && asset.sha256 === payload.sha256,
    )
    .map(([key]) => key);
}

function buildMetadata(content: BlueskyInterchangeContent): BlueskyArchiveMetadata {
  const metadata = {
    format: "cyd-archive",
    platform: "bluesky",
    version: 2,
    createdAt: content.archive.created_at,
    accountDid: content.archive.account_did,
    accountUuid: content.archive.account_uuid,
    completeness: content.archive.completeness,
  };

  // Check the writer's own output with the reader's rules before it is
  // packaged. A writer that cannot satisfy Cyd's own metadata reader has no
  // business claiming to satisfy anybody else's.
  const classified = classifyBlueskyArchiveMetadata(metadata);
  if (!classified.supported) {
    throw new BlueskyArchiveExportError("invalid-entry", classified.error);
  }
  return classified.metadata;
}

function summarizeAssets(content: BlueskyInterchangeContent): BlueskyArchiveAssetSummary {
  const count = (availability: AssetRow["availability"]): number =>
    content.assets.filter((asset) => asset.availability === availability).length;
  return {
    total: content.assets.length,
    available: count("available"),
    missing: count("missing"),
    unavailable: count("unavailable"),
  };
}

/**
 * Stream the finished archive into staging.
 *
 * Media goes first, then the database, then metadata, and the manifest last —
 * it is the only entry that has to know every other entry's digest. Each media
 * file is copied straight from the account's storage to the ZIP, so packaging
 * never holds more than one chunk of a video in memory.
 */
async function packageArchive(
  environment: BlueskyArchiveExportEnvironment,
  staging: ExportStagingArea,
  options: {
    archivePath: string;
    content: BlueskyInterchangeContent;
    createdAt: Date;
    shouldCancel?: () => boolean;
    onPayloadPackaged: (packaged: number) => void;
  },
): Promise<number> {
  const writer = new BlueskyArchiveZipWriter(staging.createFile(options.archivePath), {
    modifiedAt: options.createdAt,
  });
  const manifestPayloads: BlueskyArchiveManifestPayload[] = [];

  const payloads = [...options.content.payloads].sort((left, right) =>
    left.archivePath < right.archivePath ? -1 : 1,
  );
  let packaged = 0;
  for (const payload of payloads) {
    if (options.shouldCancel?.()) {
      throw new BlueskyArchiveExportCancelled();
    }
    await writer.addStoredEntry(
      payload.archivePath,
      { byteLength: payload.byteCount, crc32: payload.crc32 },
      (push) => environment.readFile(payload.localPath, push),
    );
    manifestPayloads.push({
      path: payload.archivePath,
      bytes: payload.byteCount,
      sha256: payload.sha256,
    });
    packaged += 1;
    options.onPayloadPackaged(packaged);
  }

  const database = await compressStagedFile(
    environment,
    staging,
    BLUESKY_INTERCHANGE_PATH,
    COMPRESSED_INTERCHANGE_PATH,
  );
  await writer.addDeflatedEntry(
    DATABASE_ENTRY_PATH,
    {
      byteLength: database.byteLength,
      crc32: database.crc32,
      compressedByteLength: database.compressedByteLength,
    },
    (push) => environment.readFile(staging.locate(database.compressedPath), push),
  );
  manifestPayloads.push({
    path: DATABASE_ENTRY_PATH,
    bytes: database.byteLength,
    sha256: database.sha256,
  });

  const metadata = new TextEncoder().encode(
    `${JSON.stringify(buildMetadata(options.content), null, 2)}\n`,
  );
  await addBytesEntry(writer, environment, METADATA_ENTRY_PATH, metadata, manifestPayloads);

  const manifest = new TextEncoder().encode(
    `${JSON.stringify(
      {
        algorithm: "sha256",
        payloads: manifestPayloads.sort((left, right) =>
          left.path < right.path ? -1 : 1,
        ),
      },
      null,
      2,
    )}\n`,
  );
  await writer.addStoredEntry(
    MANIFEST_ENTRY_PATH,
    { byteLength: manifest.length, crc32: crc32Of(manifest) },
    async (push) => push(manifest),
  );

  writer.finish();
  return writer.byteLength;
}

async function addBytesEntry(
  writer: BlueskyArchiveZipWriter,
  environment: BlueskyArchiveExportEnvironment,
  path: string,
  bytes: Uint8Array,
  manifestPayloads: BlueskyArchiveManifestPayload[],
): Promise<void> {
  const hasher = environment.createHasher();
  hasher.update(bytes);
  await writer.addStoredEntry(
    path,
    { byteLength: bytes.length, crc32: crc32Of(bytes) },
    async (push) => push(bytes),
  );
  manifestPayloads.push({
    path,
    bytes: bytes.length,
    sha256: hasher.digestHex(),
  });
}

function crc32Of(bytes: Uint8Array): number {
  const checksum = new Crc32();
  checksum.update(bytes);
  return checksum.value();
}

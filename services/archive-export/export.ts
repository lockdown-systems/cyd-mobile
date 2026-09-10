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

import { resolveStagedAssets } from "./assets";
import { writeBlueskyInterchangeDatabase } from "./database-writer";
import { compressStagedFile } from "./deflate";
import { BlueskyArchiveExportError } from "./errors";
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
 * Building this writer is not the same as offering it to people: until #100
 * proves conformance both ways, export stays behind a development-only
 * affordance (ADR 0004). Resumability, staging cleanup, and the plaintext
 * warning belong to #99.
 */

const BLUESKY_INTERCHANGE_PATH = "data.db";
const COMPRESSED_INTERCHANGE_PATH = "data.db.deflate";

export type BlueskyArchiveExportPhase =
  | "staging"
  | "hashing"
  | "translating"
  | "packaging"
  | "done";

export type BlueskyArchiveExportProgress = {
  phase: BlueskyArchiveExportPhase;
  packagedPayloads: number;
  totalPayloads: number;
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
  /** The staging area holding the archive, for the caller to clean up. */
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
  const staging = environment.openStaging(request.exportId);
  const report = (
    phase: BlueskyArchiveExportPhase,
    packaged = 0,
    total = 0,
  ): void => request.onProgress?.({ phase, packagedPayloads: packaged, totalPayloads: total });

  try {
    report("staging");
    const staged = await stageBlueskyAccountSnapshot(environment, staging);

    report("hashing");
    const assets = await resolveStagedAssets(environment, staged.inventory);

    report("translating");
    const snapshotDatabase = environment.openSnapshot(staging, staged.snapshotPath);
    let content: BlueskyInterchangeContent;
    try {
      content = translateBlueskyAccountToInterchange(
        readMobileAccountSnapshot(snapshotDatabase),
        {
          accountDid: request.accountDid,
          accountUuid: request.accountUuid,
          createdAt: staged.takenAt,
          assets,
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

    const fileName = request.fileName ?? suggestFileName(request, staged.takenAt);
    report("packaging", 0, content.payloads.length);
    const byteLength = await packageArchive(environment, staging, {
      archivePath: fileName,
      content,
      createdAt: staged.takenAt,
      onPayloadPackaged: (packaged) =>
        report("packaging", packaged, content.payloads.length),
    });

    report("done", content.payloads.length, content.payloads.length);
    return {
      exportId: request.exportId,
      location: staging.locate(fileName),
      fileName,
      byteLength,
      metadata: buildMetadata(content),
      assets: summarizeAssets(content),
      staging,
    };
  } catch (error) {
    // An export that failed leaves nothing worth keeping: the archive is
    // half-written and the account it came from is untouched. #99 replaces this
    // with checkpoints an interrupted export can resume from.
    staging.destroy();
    throw error;
  }
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

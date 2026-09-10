import {
  classifyBlueskyArchiveMetadata,
  type BlueskyArchiveMetadata,
} from "@/services/archive-metadata";

import {
  BlueskyArchiveIntakeCancelled,
  BlueskyArchiveIntakeError,
  isRetryableBlueskyArchiveIntakeFailure,
  type BlueskyArchiveIntakeErrorCode,
} from "./errors";
import {
  formatBytes,
  resolveBlueskyArchiveIntakeLimits,
  type BlueskyArchiveIntakeLimits,
} from "./limits";
import {
  MANIFEST_ENTRY_PATH,
  METADATA_ENTRY_PATH,
  parseBlueskyArchiveManifest,
  planBlueskyArchivePayloads,
  type BlueskyArchiveManifestPayload,
  type BlueskyArchivePayloadPlan,
} from "./manifest";
import type {
  BlueskyArchiveByteReader,
  BlueskyArchiveIntakeEnvironment,
  BlueskyArchiveStagingArea,
} from "./ports";
import { readZipCentralDirectory, streamZipEntry, type ZipEntry } from "./zip-reader";

/**
 * Durable, resumable intake of a Cyd Bluesky archive.
 *
 * Intake ends at *prepared*: a fully verified copy of the archive's payloads
 * sitting in an isolated staging area, ready for a later transactional merge.
 * It deliberately knows nothing about Bluesky local accounts, which is what
 * makes "cancelling leaves live accounts untouched" a property of the code
 * rather than a promise. See ADR 0006 and ADR 0009.
 */

/** Where the checkpoint lives, kept out of `payload/` so no entry can forge it. */
const CHECKPOINT_PATH = "intake.json";
const PAYLOAD_PREFIX = "payload/";
const CHECKPOINT_VERSION = 1;

export type BlueskyArchiveIntakePhase =
  | "awaiting-confirmation"
  | "extracting"
  | "prepared";

type ArchiveIntakeCheckpoint = {
  version: number;
  sourceUri: string;
  sourceBytes: number;
  phase: BlueskyArchiveIntakePhase;
  confirmedLargeArchive: boolean;
  totalBytes: number | null;
  metadata: BlueskyArchiveMetadata | null;
  payloads: BlueskyArchiveManifestPayload[];
  extracted: string[];
  updatedAt: string;
};

export type PreparedBlueskyArchive = {
  status: "prepared";
  intakeId: string;
  stagingRoot: string;
  metadata: BlueskyArchiveMetadata;
  payloads: BlueskyArchiveManifestPayload[];
  totalBytes: number;
};

export type BlueskyArchiveIntakeOutcome =
  | PreparedBlueskyArchive
  | {
      status: "needs-confirmation";
      intakeId: string;
      reason: "large-archive";
      totalBytes: number;
      thresholdBytes: number;
      message: string;
    }
  | {
      status: "rejected";
      intakeId: string;
      code: BlueskyArchiveIntakeErrorCode;
      message: string;
    }
  | { status: "cancelled"; intakeId: string };

export type BlueskyArchiveIntakeProgress = {
  phase: BlueskyArchiveIntakePhase;
  preparedBytes: number;
  totalBytes: number;
};

export type RunBlueskyArchiveIntakeOptions = {
  /** Stable id for this import, reused to resume it after a restart. */
  intakeId: string;
  /** Identifies the picked file, so a resumed intake cannot pick up a different one. */
  sourceUri: string;
  openReader: () => Promise<BlueskyArchiveByteReader>;
  /** Set once the person has agreed to import an unusually large archive. */
  confirmLargeArchive?: boolean;
  limits?: Partial<BlueskyArchiveIntakeLimits>;
  shouldCancel?: () => boolean;
  onProgress?: (progress: BlueskyArchiveIntakeProgress) => void;
};

export function stagedPayloadPath(archivePath: string): string {
  return `${PAYLOAD_PREFIX}${archivePath}`;
}

function readCheckpoint(staging: BlueskyArchiveStagingArea): ArchiveIntakeCheckpoint | null {
  const text = staging.readText(CHECKPOINT_PATH);
  if (text === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as ArchiveIntakeCheckpoint;
    return parsed.version === CHECKPOINT_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

function writeCheckpoint(
  staging: BlueskyArchiveStagingArea,
  environment: BlueskyArchiveIntakeEnvironment,
  checkpoint: Omit<ArchiveIntakeCheckpoint, "version" | "updatedAt">,
): ArchiveIntakeCheckpoint {
  const stored: ArchiveIntakeCheckpoint = {
    ...checkpoint,
    version: CHECKPOINT_VERSION,
    updatedAt: environment.now().toISOString(),
  };
  staging.writeText(CHECKPOINT_PATH, JSON.stringify(stored));
  return stored;
}

/** Read a small entry (metadata or manifest) fully into memory. */
async function readBlueskyArchiveDescriptor(
  reader: BlueskyArchiveByteReader,
  environment: BlueskyArchiveIntakeEnvironment,
  entry: ZipEntry,
  limits: BlueskyArchiveIntakeLimits,
): Promise<{ text: string; bytes: number; sha256: string }> {
  if (entry.uncompressedBytes > limits.maxDescriptorBytes) {
    throw new BlueskyArchiveIntakeError(
      "manifest-invalid",
      `The archive's ${entry.path} is too large to read.`,
    );
  }
  const chunks: Uint8Array[] = [];
  const streamed = await streamZipEntry(reader, entry, {
    createDecompressor: environment.createDecompressor,
    createHasher: environment.createHasher,
    onBytes: (bytes) => chunks.push(bytes.slice()),
  });
  const joined = new Uint8Array(streamed.bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return {
    text: new TextDecoder().decode(joined),
    bytes: streamed.bytes,
    sha256: streamed.sha256,
  };
}

function requireEntry(entries: ZipEntry[], path: string, code: BlueskyArchiveIntakeErrorCode): ZipEntry {
  const entry = entries.find((candidate) => candidate.path === path);
  if (!entry) {
    throw new BlueskyArchiveIntakeError(code, `The archive is missing ${path}.`);
  }
  return entry;
}

type InspectionResult = {
  metadata: BlueskyArchiveMetadata;
  plan: BlueskyArchivePayloadPlan[];
  totalBytes: number;
};

/**
 * Everything that must be true before a single payload byte is written.
 */
async function inspectBlueskyArchive(
  reader: BlueskyArchiveByteReader,
  environment: BlueskyArchiveIntakeEnvironment,
  limits: BlueskyArchiveIntakeLimits,
): Promise<InspectionResult> {
  const directory = await readZipCentralDirectory(reader, {
    maxEntries: limits.maxEntries,
  });

  if (directory.totalUncompressedBytes > limits.maxTotalBytes) {
    throw new BlueskyArchiveIntakeError(
      "archive-too-large",
      `This archive unpacks to ${formatBytes(directory.totalUncompressedBytes)}, which is more than Cyd can import.`,
    );
  }
  if (
    directory.totalUncompressedBytes > limits.expansionRatioFloorBytes &&
    directory.totalCompressedBytes > 0 &&
    directory.totalUncompressedBytes / directory.totalCompressedBytes >
      limits.maxExpansionRatio
  ) {
    throw new BlueskyArchiveIntakeError(
      "expansion-exceeded",
      "This archive expands far more than a real Bluesky archive does, so Cyd will not unpack it.",
    );
  }

  const manifestEntry = requireEntry(
    directory.entries,
    MANIFEST_ENTRY_PATH,
    "manifest-missing",
  );
  const manifestDescriptor = await readBlueskyArchiveDescriptor(
    reader,
    environment,
    manifestEntry,
    limits,
  );
  const manifest = parseBlueskyArchiveManifest(manifestDescriptor.text);
  const plan = planBlueskyArchivePayloads(manifest, directory.entries);

  const metadataEntry = requireEntry(
    directory.entries,
    METADATA_ENTRY_PATH,
    "metadata-missing",
  );
  const metadataDescriptor = await readBlueskyArchiveDescriptor(
    reader,
    environment,
    metadataEntry,
    limits,
  );
  const metadataPayload = manifest.payloads.find(
    (payload) => payload.path === METADATA_ENTRY_PATH,
  );
  if (metadataDescriptor.sha256 !== metadataPayload?.sha256) {
    throw new BlueskyArchiveIntakeError(
      "digest-mismatch",
      "The archive's metadata does not match the digest its manifest declares.",
    );
  }

  let parsedMetadata: unknown;
  try {
    parsedMetadata = JSON.parse(metadataDescriptor.text);
  } catch {
    throw new BlueskyArchiveIntakeError(
      "unsupported-archive",
      "Invalid or corrupt Bluesky archive: metadata.json is not valid JSON.",
    );
  }
  const classified = classifyBlueskyArchiveMetadata(parsedMetadata);
  if (!classified.supported) {
    throw new BlueskyArchiveIntakeError("unsupported-archive", classified.error);
  }

  const totalBytes = plan.reduce((sum, planned) => sum + planned.payload.bytes, 0);
  return { metadata: classified.metadata, plan, totalBytes };
}

function samePlan(
  checkpointed: BlueskyArchiveManifestPayload[],
  plan: BlueskyArchivePayloadPlan[],
): boolean {
  if (checkpointed.length !== plan.length) {
    return false;
  }
  return checkpointed.every(
    (payload, index) =>
      payload.path === plan[index].payload.path &&
      payload.bytes === plan[index].payload.bytes &&
      payload.sha256 === plan[index].payload.sha256,
  );
}

/**
 * Run — or resume — intake for one archive.
 *
 * Calling this again with the same `intakeId` after the app was killed picks
 * up where it left off: already-verified payloads are not re-extracted, and a
 * confirmation the person already gave is not asked for twice.
 */
export async function runBlueskyArchiveIntake(
  environment: BlueskyArchiveIntakeEnvironment,
  options: RunBlueskyArchiveIntakeOptions,
): Promise<BlueskyArchiveIntakeOutcome> {
  const limits = resolveBlueskyArchiveIntakeLimits(options.limits);
  const { intakeId } = options;
  let staging = environment.openStaging(intakeId);
  const reader = await options.openReader();
  // Tracks whether there is verified work in staging worth keeping if this run
  // fails for a reason that is not the archive's fault.
  let stagedBytes = 0;

  try {
    let checkpoint = readCheckpoint(staging);
    if (
      checkpoint &&
      (checkpoint.sourceUri !== options.sourceUri ||
        checkpoint.sourceBytes !== reader.byteLength)
    ) {
      // A different file under the same import: nothing staged can be reused.
      staging.destroy();
      staging = environment.openStaging(intakeId);
      checkpoint = null;
    }

    const confirmedLargeArchive =
      options.confirmLargeArchive === true ||
      checkpoint?.confirmedLargeArchive === true;

    const inspection = await inspectBlueskyArchive(reader, environment, limits);
    const { metadata, plan, totalBytes } = inspection;

    if (checkpoint && !samePlan(checkpoint.payloads, plan)) {
      // The archive changed underneath us; start its staging over.
      staging.destroy();
      staging = environment.openStaging(intakeId);
      checkpoint = null;
    }

    // A checkpointed payload counts as done only if what is on disk is still
    // the size it was verified at. Anything else is staged again.
    const extracted = new Set(
      plan
        .filter(
          (planned) =>
            checkpoint?.extracted.includes(planned.payload.path) === true &&
            staging.fileSize(stagedPayloadPath(planned.payload.path)) ===
              planned.payload.bytes,
        )
        .map((planned) => planned.payload.path),
    );
    let preparedBytes = plan
      .filter((planned) => extracted.has(planned.payload.path))
      .reduce((sum, planned) => sum + planned.payload.bytes, 0);
    stagedBytes = preparedBytes;

    // Free space is measured against the work that is left. A resumed import
    // must not be told there is no room for payloads it has already written.
    const remainingBytes = totalBytes - preparedBytes;
    const availableBytes = environment.availableStorageBytes();
    if (availableBytes < remainingBytes + limits.storageHeadroomBytes) {
      throw new BlueskyArchiveIntakeError(
        "insufficient-storage",
        `This archive needs ${formatBytes(remainingBytes)} of free space, and only ${formatBytes(availableBytes)} is available.`,
      );
    }

    if (totalBytes > limits.confirmationThresholdBytes && !confirmedLargeArchive) {
      writeCheckpoint(staging, environment, {
        sourceUri: options.sourceUri,
        sourceBytes: reader.byteLength,
        phase: "awaiting-confirmation",
        confirmedLargeArchive: false,
        totalBytes,
        metadata,
        payloads: plan.map((planned) => planned.payload),
        extracted: [...extracted],
      });
      return {
        status: "needs-confirmation",
        intakeId,
        reason: "large-archive",
        totalBytes,
        thresholdBytes: limits.confirmationThresholdBytes,
        message: `This Bluesky archive is ${formatBytes(totalBytes)}. Importing it will use that much space on this device.`,
      };
    }

    checkpoint = writeCheckpoint(staging, environment, {
      sourceUri: options.sourceUri,
      sourceBytes: reader.byteLength,
      phase: "extracting",
      confirmedLargeArchive,
      totalBytes,
      metadata,
      payloads: plan.map((planned) => planned.payload),
      extracted: [...extracted],
    });
    options.onProgress?.({ phase: "extracting", preparedBytes, totalBytes });

    for (const planned of plan) {
      if (extracted.has(planned.payload.path)) {
        continue;
      }
      const destination = staging.createFile(stagedPayloadPath(planned.payload.path));
      let streamed;
      try {
        streamed = await streamZipEntry(reader, planned.entry, {
          createDecompressor: environment.createDecompressor,
          createHasher: environment.createHasher,
          onBytes: (bytes) => destination.write(bytes),
          shouldCancel: options.shouldCancel,
        });
      } finally {
        destination.close();
      }

      if (streamed.bytes !== planned.payload.bytes) {
        throw new BlueskyArchiveIntakeError(
          "size-mismatch",
          `${planned.payload.path} is not the size the archive's manifest declares.`,
        );
      }
      if (streamed.sha256 !== planned.payload.sha256) {
        throw new BlueskyArchiveIntakeError(
          "digest-mismatch",
          `${planned.payload.path} does not match the digest the archive's manifest declares.`,
        );
      }

      extracted.add(planned.payload.path);
      preparedBytes += planned.payload.bytes;
      stagedBytes = preparedBytes;
      checkpoint = writeCheckpoint(staging, environment, {
        ...checkpoint,
        extracted: [...extracted],
      });
      options.onProgress?.({ phase: "extracting", preparedBytes, totalBytes });
    }

    writeCheckpoint(staging, environment, { ...checkpoint, phase: "prepared" });
    options.onProgress?.({ phase: "prepared", preparedBytes, totalBytes });

    return {
      status: "prepared",
      intakeId,
      stagingRoot: staging.root,
      metadata,
      payloads: plan.map((planned) => planned.payload),
      totalBytes,
    };
  } catch (error) {
    if (error instanceof BlueskyArchiveIntakeCancelled) {
      staging.destroy();
      return { status: "cancelled", intakeId };
    }
    if (error instanceof BlueskyArchiveIntakeError) {
      // A rejection blames the archive and is final, so nothing staged for it
      // is worth keeping. A failure that blames the device is not: verified
      // payloads stay put so freeing space and retrying resumes the import.
      if (!isRetryableBlueskyArchiveIntakeFailure(error.code) || stagedBytes === 0) {
        staging.destroy();
      }
      return {
        status: "rejected",
        intakeId,
        code: error.code,
        message: error.message,
      };
    }
    // An I/O failure may well succeed next launch: leave the checkpoint alone.
    throw error;
  } finally {
    reader.close();
  }
}

/** Abandon an import and remove everything it staged. */
export function cancelBlueskyArchiveIntake(
  environment: BlueskyArchiveIntakeEnvironment,
  intakeId: string,
): void {
  environment.openStaging(intakeId).destroy();
}

export type ResumableBlueskyArchiveIntake = {
  intakeId: string;
  sourceUri: string;
  /** The Bluesky identity the staged archive belongs to, once known. */
  accountDid: string | null;
  phase: BlueskyArchiveIntakePhase;
  totalBytes: number | null;
  preparedBytes: number;
  updatedAt: string;
};

/**
 * Imports left behind by an earlier launch.
 *
 * Staging with no readable checkpoint is removed rather than reported: it can
 * only be debris from a run that died before it recorded anything.
 */
export function listResumableBlueskyArchiveIntakes(
  environment: BlueskyArchiveIntakeEnvironment,
): ResumableBlueskyArchiveIntake[] {
  const resumable: ResumableBlueskyArchiveIntake[] = [];
  for (const intakeId of environment.listStagingIds()) {
    const staging = environment.openStaging(intakeId);
    const checkpoint = readCheckpoint(staging);
    if (!checkpoint) {
      staging.destroy();
      continue;
    }
    const preparedBytes = checkpoint.payloads
      .filter((payload) => checkpoint.extracted.includes(payload.path))
      .reduce((sum, payload) => sum + payload.bytes, 0);
    resumable.push({
      intakeId,
      sourceUri: checkpoint.sourceUri,
      accountDid: checkpoint.metadata?.accountDid ?? null,
      phase: checkpoint.phase,
      totalBytes: checkpoint.totalBytes,
      preparedBytes,
      updatedAt: checkpoint.updatedAt,
    });
  }
  return resumable;
}

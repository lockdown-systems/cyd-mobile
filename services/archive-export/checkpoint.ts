import type { BlueskyArchiveMetadata } from "@/services/archive-metadata";

import type { ResolvedAsset, StagedAsset } from "./assets";
import type {
  BlueskyArchiveExportEnvironment,
  ExportStagingArea,
} from "./ports";

/**
 * What an export has already done, written where a restart can find it.
 *
 * Cyd Mobile does not promise an export finishes in the background; it
 * promises that one the operating system kills is picked up where it stopped
 * rather than started over (ADR 0006). That promise is this file: the moment
 * the archive describes, the files that moment inventoried, and the digest of
 * every one already read.
 *
 * The checkpoint is what makes a resumed export the *same* export. Taking the
 * snapshot again would be easier, and it would quietly move the archive's
 * point in time forward past whatever the account saved or deleted in between
 * (ADR 0010). So the snapshot is taken once, and everything after it — hashing,
 * translating, packaging — is work the checkpoint can hand back.
 */

/**
 * The part of the export environment that only knows about staging.
 *
 * Finding and clearing abandoned exports is not an account operation: it needs
 * no database, no pause, and no identity, and asking for them would mean a
 * connected account before Cyd could tidy up after itself.
 */
export type BlueskyArchiveExportStaging = Pick<
  BlueskyArchiveExportEnvironment,
  "openStaging" | "listStagingIds"
>;

/** Kept beside the staged files it describes, and never inside the archive. */
export const EXPORT_CHECKPOINT_PATH = "export.json";

const CHECKPOINT_VERSION = 1;

export type BlueskyArchiveExportPhase =
  | "staging"
  | "hashing"
  | "translating"
  | "packaging"
  | "done";

export type BlueskyArchiveExportCheckpoint = {
  version: number;
  accountUuid: string;
  accountDid: string;
  accountHandle: string | null;
  phase: BlueskyArchiveExportPhase;
  /** The moment the archive describes, as ISO 8601. */
  takenAt: string;
  snapshotPath: string;
  inventory: StagedAsset[];
  /** Assets already read and hashed, by key. */
  resolved: [string, ResolvedAsset][];
  fileName: string | null;
  /**
   * What the finished archive turned out to be, once there is one.
   *
   * An export can be killed between packaging the archive and handing it over,
   * and the archive is sitting in staging, whole. Keeping its summary here is
   * what lets the next launch offer that file rather than rebuilding a
   * gigabyte of it to say the same thing.
   */
  result: FinishedBlueskyArchive | null;
  updatedAt: string;
};

export type FinishedBlueskyArchive = {
  fileName: string;
  byteLength: number;
  metadata: BlueskyArchiveMetadata;
  assets: {
    total: number;
    available: number;
    missing: number;
    unavailable: number;
  };
};

export function readExportCheckpoint(
  staging: ExportStagingArea,
): BlueskyArchiveExportCheckpoint | null {
  const text = staging.readText(EXPORT_CHECKPOINT_PATH);
  if (text === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as BlueskyArchiveExportCheckpoint;
    return parsed.version === CHECKPOINT_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

export function writeExportCheckpoint(
  staging: ExportStagingArea,
  environment: BlueskyArchiveExportEnvironment,
  checkpoint: Omit<BlueskyArchiveExportCheckpoint, "version" | "updatedAt">,
): BlueskyArchiveExportCheckpoint {
  const stored: BlueskyArchiveExportCheckpoint = {
    ...checkpoint,
    version: CHECKPOINT_VERSION,
    updatedAt: environment.now().toISOString(),
  };
  staging.writeText(EXPORT_CHECKPOINT_PATH, JSON.stringify(stored));
  return stored;
}

/**
 * Whether staged work can be handed to this request.
 *
 * A checkpoint is only usable by the export that wrote it: the same Bluesky
 * local account, the same Bluesky identity, and a snapshot still on disk.
 * Anything else is debris that happens to share an id, and reusing it would
 * mean writing one account's data into another's archive.
 */
export function checkpointMatches(
  checkpoint: BlueskyArchiveExportCheckpoint,
  staging: ExportStagingArea,
  request: { accountUuid: string; accountDid: string },
): boolean {
  return (
    checkpoint.accountUuid === request.accountUuid &&
    checkpoint.accountDid === request.accountDid &&
    staging.fileExists(checkpoint.snapshotPath)
  );
}

export type ResumableBlueskyArchiveExport = {
  exportId: string;
  accountUuid: string;
  accountDid: string;
  accountHandle: string | null;
  phase: BlueskyArchiveExportPhase;
  /** Preserved files already read and hashed, of the ones inventoried. */
  hashedAssets: number;
  totalAssets: number;
  /** The finished archive's name, once there is one. */
  fileName: string | null;
  /** What that archive is, for an export that got as far as producing one. */
  result: FinishedBlueskyArchive | null;
  updatedAt: string;
};

/**
 * Exports an earlier launch left behind, finished or not.
 *
 * Staging with no readable checkpoint is removed rather than reported: it can
 * only be debris from a run that died before it recorded anything, and an
 * export's staging is the size of the archive it is building.
 */
export function listResumableBlueskyArchiveExports(
  environment: BlueskyArchiveExportStaging,
): ResumableBlueskyArchiveExport[] {
  const resumable: ResumableBlueskyArchiveExport[] = [];
  for (const exportId of environment.listStagingIds()) {
    const staging = environment.openStaging(exportId);
    const checkpoint = readExportCheckpoint(staging);
    if (!checkpoint) {
      staging.destroy();
      continue;
    }
    resumable.push({
      exportId,
      accountUuid: checkpoint.accountUuid,
      accountDid: checkpoint.accountDid,
      accountHandle: checkpoint.accountHandle,
      phase: checkpoint.phase,
      hashedAssets: checkpoint.resolved.length,
      totalAssets: checkpoint.inventory.length,
      fileName: checkpoint.fileName,
      result: checkpoint.result,
      updatedAt: checkpoint.updatedAt,
    });
  }
  return resumable;
}

/**
 * The export this Bluesky local account has staged, if it has one.
 *
 * At most one: an account exports itself one archive at a time, so anything
 * older than its newest checkpoint is a run nobody came back to, and each one
 * holds a copy of that account's database. Staging belonging to other accounts
 * is left where it is — it is theirs to resume, not this account's to sweep.
 */
export function claimBlueskyArchiveExport(
  environment: BlueskyArchiveExportStaging,
  accountUuid: string,
): ResumableBlueskyArchiveExport | null {
  const mine = listResumableBlueskyArchiveExports(environment)
    .filter((candidate) => candidate.accountUuid === accountUuid)
    .sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1));
  for (const abandoned of mine.slice(1)) {
    discardBlueskyArchiveExport(environment, abandoned.exportId);
  }
  return mine[0] ?? null;
}

/**
 * Throw away everything an export staged.
 *
 * This is the end of every export that is not going to be resumed: one that
 * finished and was handed over, one somebody walked away from, and one that
 * failed in a way that will fail again. Staging holds a copy of the account
 * database and a whole archive, so leaving it is not a small thing to leave.
 */
export function discardBlueskyArchiveExport(
  environment: BlueskyArchiveExportStaging,
  exportId: string,
): void {
  environment.openStaging(exportId).destroy();
}

import type { StagedAsset } from "./assets";
import { BlueskyArchiveExportError } from "./errors";
import { readAssetInventory } from "./mobile-snapshot";
import type { BlueskyArchiveExportEnvironment, ExportStagingArea } from "./ports";

/**
 * Taking the one moment a Cyd Bluesky archive describes (ADR 0010).
 *
 * Everything an export claims comes from here: a SQLite copy of the account
 * database, and a list of where each preserved file was and how big it was at
 * that instant. Both are taken with account-mutating work paused, so they
 * cannot disagree with each other — a save job that resumes a millisecond
 * later can add records and files, but it cannot change what this snapshot
 * already saw.
 *
 * The pause covers only these two things. Hashing megabytes of video and
 * packaging a ZIP with saving frozen would be a long, visible stall for no
 * benefit: an asset that changes after the inventory is caught by comparing it
 * against the inventory, and reported as unavailable.
 */

export const SNAPSHOT_DATABASE_PATH = "snapshot.db";

export type StagedAccountSnapshot = {
  /** Staging-relative path of the copied account database. */
  snapshotPath: string;
  inventory: StagedAsset[];
  takenAt: Date;
};

export async function stageBlueskyAccountSnapshot(
  environment: BlueskyArchiveExportEnvironment,
  staging: ExportStagingArea,
): Promise<StagedAccountSnapshot> {
  return environment.withAccountWorkPaused(async () => {
    try {
      await environment.snapshotAccountDatabase(staging, SNAPSHOT_DATABASE_PATH);
    } catch (error) {
      throw new BlueskyArchiveExportError(
        "snapshot-failed",
        `Cyd could not copy this account's data for export: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const database = environment.openSnapshot(staging, SNAPSHOT_DATABASE_PATH);
    try {
      const inventory = readAssetInventory(database).map((row) => ({
        ...row,
        stagedByteLength: row.localPath
          ? (environment.statFile(row.localPath)?.byteLength ?? null)
          : null,
      }));
      return {
        snapshotPath: SNAPSHOT_DATABASE_PATH,
        inventory,
        takenAt: environment.now(),
      };
    } catch (error) {
      throw new BlueskyArchiveExportError(
        "unreadable-snapshot",
        `Cyd could not read the copy it made of this account's data: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      database.close();
    }
  });
}

import { Paths } from "expo-file-system";

function directoryUri(
  directory: { uri: string } | null | undefined,
  description: string,
): string {
  if (!directory?.uri) {
    throw new Error(`Unable to resolve ${description}`);
  }
  return directory.uri.endsWith("/") ? directory.uri : `${directory.uri}/`;
}

function getDocumentRoot(): string {
  return directoryUri(Paths.document, "document storage");
}

export function getBackupEligibleDataRoot(): string {
  return getDocumentRoot();
}

/**
 * Directory holding in-progress Bluesky archive import staging.
 *
 * Mirrors `ARCHIVE_STAGING_PATH` in plugins/android-backup-rules.js, which
 * keeps this path out of every Android backup path.
 */
export const ARCHIVE_STAGING_DIRECTORY = "archive-intake";

/**
 * Where an import unpacks an archive while it works.
 *
 * This is durable storage rather than the cache, because an import that the
 * system interrupts has to be resumable on the next launch (ADR 0006) and the
 * cache can be evicted underneath it. It is excluded from device backup
 * instead: staging is half-unpacked working state, not committed account data
 * (ADR 0014).
 */
export function getArchiveStagingRoot(): string {
  return `${getDocumentRoot()}${ARCHIVE_STAGING_DIRECTORY}/`;
}

/**
 * Directory holding in-progress Bluesky archive export staging.
 *
 * Mirrors `ARCHIVE_EXPORT_PATH` in plugins/android-backup-rules.js.
 */
export const ARCHIVE_EXPORT_DIRECTORY = "archive-export";

/**
 * Where an export assembles an archive while it works.
 *
 * Durable rather than cache storage for the same reason import staging is: an
 * export the system interrupts has to be resumable on the next launch (ADR
 * 0006), and the cache can be evicted underneath it. It is excluded from
 * device backup: a half-written archive is working state, and the Bluesky
 * saved data it was built from is backed up already (ADR 0014).
 */
export function getArchiveExportStagingRoot(): string {
  return `${getDocumentRoot()}${ARCHIVE_EXPORT_DIRECTORY}/`;
}

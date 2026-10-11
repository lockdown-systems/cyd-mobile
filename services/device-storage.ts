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
 * Durable storage rather than the cache, so an interrupted import can resume
 * on the next launch; excluded from device backup because staging is
 * half-unpacked working state, not committed account data.
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
 * Durable rather than cache storage for the same reason import staging is;
 * excluded from device backup because a half-written archive is working state,
 * and the saved data it was built from is backed up already.
 */
export function getArchiveExportStagingRoot(): string {
  return `${getDocumentRoot()}${ARCHIVE_EXPORT_DIRECTORY}/`;
}

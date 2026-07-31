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

export function getBackupEligibleDataRoot(): string {
  return directoryUri(Paths.document, "backup-eligible document storage");
}

function getBackupExcludedCacheRoot(): string {
  return directoryUri(Paths.cache, "backup-excluded cache storage");
}

export function buildBlueskyArchiveTemporaryPaths(jobUUID: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(jobUUID)) {
    throw new Error("Invalid Bluesky archive job UUID");
  }

  const rootDir = `${getBackupExcludedCacheRoot()}bluesky-archives/`;
  return {
    rootDir,
    stagingDir: `${rootDir}staging/${jobUUID}/`,
    reproducibleCacheDir: `${rootDir}reproducible/${jobUUID}/`,
  } as const;
}

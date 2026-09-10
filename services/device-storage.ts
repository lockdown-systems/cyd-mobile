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

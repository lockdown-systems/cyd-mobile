/**
 * Cyd Bluesky archive export: turning one Bluesky local account into a
 * self-contained, point-in-time version 2 archive.
 *
 * Export is the only component that can produce a Cyd Bluesky archive, which
 * is why it is built before the readers that consume it (ADR 0004). Offering
 * it to people is a separate decision, gated on #100.
 */

export { runBlueskyArchiveExport } from "./export";
export type {
  BlueskyArchiveAssetSummary,
  BlueskyArchiveExportPhase,
  BlueskyArchiveExportProgress,
  BlueskyArchiveExportRequest,
  BlueskyArchiveExportResult,
} from "./export";
export { BlueskyArchiveExportError } from "./errors";
export type { BlueskyArchiveExportErrorCode } from "./errors";
export { createBlueskyArchiveExportEnvironment } from "./environment";
export { PORTABLE_SETTING_KEYS, profileIdForDid } from "./interchange";
export {
  portableSettingsFromAccountRow,
  type BlueskyAccountSettingsRow,
} from "./portable-settings";
export type {
  PortableSettingKey,
  PortableSettings,
} from "./interchange";
export { BLUESKY_ARCHIVE_V2_SCHEMA_SQL } from "./schema";
export type {
  BlueskyArchiveExportEnvironment,
  ExportStagingArea,
  ReadableDatabase,
  WritableDatabase,
} from "./ports";

/**
 * Restoring a prepared Cyd Bluesky archive into a Bluesky local account,
 * browsable offline with no Bluesky connection and no premium subscription.
 * Covers the case where the identity is new to this installation; merging into
 * an existing account is a recovery union with its own reconciliation rules.
 *
 * The v2 interchange reader, translator, and media copier are exported because
 * merge needs the same pieces — not to grow a second adapter.
 */

export { createBlueskyArchiveRestoreEnvironment } from "./environment";
export { BlueskyArchiveRestoreError } from "./errors";
export type { BlueskyArchiveRestoreErrorCode } from "./errors";
export type {
  LocalAccountIdentity,
  RestoredUuidRemapping,
} from "./identity";
export { restoreBlueskyArchiveAccount } from "./restore";
export type {
  BlueskyArchiveRestorePhase,
  BlueskyArchiveRestoreProgress,
  BlueskyArchiveRestoreRequest,
  BlueskyArchiveRestoreResult,
  RestoredAssetSummary,
  RestoredCategoryCounts,
} from "./restore";
export { readBlueskyInterchange } from "./interchange-reader";
export type {
  BlueskyInterchangeSnapshot,
  InterchangeAsset,
} from "./interchange-reader";
export {
  placeArchivedMedia,
  predictArchivedMedia,
  restoredMediaFileName,
} from "./media";
export { translateInterchangeToMobileRows } from "./mobile-rows";
export type {
  MobileBookmarkWrite,
  MobileConversationWrite,
  MobileFollowWrite,
  MobileMediaAssetWrite,
  MobileMessageWrite,
  MobilePostExternalWrite,
  MobilePostMediaWrite,
  MobilePostWrite,
  MobileProfileWrite,
  RestoredAssetPlacement,
  RestoredMobileAccount,
  UnrestorableContent,
} from "./mobile-rows";
export type {
  BlueskyArchiveRestoreEnvironment,
  CreatedLocalAccount,
  DiscardableAccount,
  NewLocalAccountRequest,
  PreparedArchiveLocation,
  PreparedArchiveStore,
  ReadableInterchangeDatabase,
  RestorableSettingColumn,
  RestoredAccountDatabase,
  RestoredAccountSettings,
  StoredMediaFile,
} from "./ports";

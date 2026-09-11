/**
 * Restoring a prepared Cyd Bluesky archive into a Bluesky local account.
 *
 * This is the second half of a Bluesky archive import: intake ends with a
 * verified archive sitting in isolated staging (#95), and restore turns that
 * into an account somebody can browse offline, with no Bluesky connection and
 * no premium subscription.
 *
 * It covers the case where the identity is new to this installation. Merging
 * an archive into a Bluesky local account that already exists is a recovery
 * union with its own reconciliation rules (#97).
 */

export { createBlueskyArchiveRestoreEnvironment } from "./environment";
export { BlueskyArchiveRestoreError } from "./errors";
export type { BlueskyArchiveRestoreErrorCode } from "./errors";
export {
  chooseRestoredAccountHandle,
  chooseRestoredAccountUuid,
} from "./identity";
export type {
  ChosenRestoredAccountUuid,
  LocalAccountIdentity,
  RestoredUuidRemapping,
} from "./identity";
export { readBlueskyInterchange } from "./interchange-reader";
export type {
  BlueskyInterchangeSnapshot,
  InterchangeAsset,
  InterchangeSelectionCategory,
} from "./interchange-reader";
export { translateInterchangeToMobileRows } from "./mobile-rows";
export type {
  MobileMediaAssetWrite,
  MobilePostWrite,
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
  RestoredAccountDatabase,
} from "./ports";
export {
  restoreBlueskyArchiveAccount,
  restoredMediaFileName,
} from "./restore";
export type {
  BlueskyArchiveRestorePhase,
  BlueskyArchiveRestoreProgress,
  BlueskyArchiveRestoreRequest,
  BlueskyArchiveRestoreResult,
  RestoredAssetSummary,
  RestoredCategoryCounts,
} from "./restore";
export { accountSettingsFromPortableSettings } from "./portable-settings";
export { writeRestoredAccountRows } from "./account-writer";

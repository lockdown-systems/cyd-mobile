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
 *
 * What leaves this module is the entry point, the failures a caller has to
 * tell somebody about, and the ports an adapter has to implement. Everything
 * else — the translation and the row writer — is internal, and its tests reach
 * for it directly.
 *
 * The pieces a merge needs are the exception. Reading a version 2 interchange
 * database, translating it into Mobile's rows, and copying its media into an
 * account are the same work whichever half of the import is running, so they
 * are exported here and #97 consumes them rather than growing a second v2
 * adapter that can drift from this one.
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
export { placeArchivedMedia, restoredMediaFileName } from "./media";
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

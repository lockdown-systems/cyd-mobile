/**
 * Merging a Cyd Bluesky archive into a Bluesky local account Cyd already has.
 *
 * A Bluesky archive import is one act with two possible endings: an identity
 * this installation does not hold is restored as a new Bluesky local account
 * (#96), and one it does hold is merged here. The merge is a recovery union —
 * everything either side knows survives, records sharing a stable Bluesky
 * identifier collapse into one, and the account's own settings, schedules,
 * Bluesky connection and local choices are not the archive's business.
 *
 * Two things leave this module: where an archive should go, and what merging
 * it would do. The union rules, the row reader and the writer are internal,
 * and the tests reach for them directly.
 */

export { chooseBlueskyArchiveImportDestination } from "./destination";
export type { BlueskyArchiveImportDestination } from "./destination";
export { createBlueskyArchiveMergeEnvironment } from "./environment";
export { BlueskyArchiveMergeError } from "./errors";
export type { BlueskyArchiveMergeErrorCode } from "./errors";
export {
  commitBlueskyArchiveMerge,
  previewBlueskyArchiveMerge,
} from "./merge";
export type {
  BlueskyArchiveMergePhase,
  BlueskyArchiveMergePreview,
  BlueskyArchiveMergeProgress,
  BlueskyArchiveMergeRequest,
  BlueskyArchiveMergeResult,
  MergedAssetSummary,
} from "./merge";
export { planBlueskyArchiveMerge, totalMergeChanges } from "./merge-plan";
export type {
  BlueskyArchiveMergeCounts,
  BlueskyArchiveMergePlan,
  BlueskyArchiveMergeSummary,
  BlueskyArchiveMergeTotals,
} from "./merge-plan";
export type {
  BlueskyArchiveMergeEnvironment,
  MergeableAccountDatabase,
} from "./ports";
export type {
  ExistingAccountRows,
  ExistingMediaAssetRow,
  ExistingPostRow,
} from "./rows";

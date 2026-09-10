/**
 * Cyd Bluesky archive intake: reading a version 2 archive off the device into
 * verified, isolated staging, safely enough to survive a hostile file and a
 * terminated app.
 *
 * Intake stops at *prepared*. Merging staged data into a Bluesky local account
 * is a separate step, so nothing here can change a live account.
 */

export { BlueskyArchiveIntakeError } from "./errors";
export type { BlueskyArchiveIntakeErrorCode } from "./errors";
export {
  createBlueskyArchiveIntakeEnvironment,
  openBlueskyArchiveByteReader,
} from "./environment";
export {
  cancelBlueskyArchiveIntake,
  listResumableBlueskyArchiveIntakes,
  runBlueskyArchiveIntake,
  stagedPayloadPath,
} from "./intake";
export type {
  BlueskyArchiveIntakePhase,
  BlueskyArchiveIntakeProgress,
  BlueskyArchiveIntakeOutcome,
  PreparedBlueskyArchive,
  ResumableBlueskyArchiveIntake,
  RunBlueskyArchiveIntakeOptions,
} from "./intake";
export { DEFAULT_BLUESKY_ARCHIVE_INTAKE_LIMITS } from "./limits";
export type { BlueskyArchiveIntakeLimits } from "./limits";
export type { BlueskyArchiveManifestPayload } from "./manifest";
export type {
  BlueskyArchiveByteReader,
  BlueskyArchiveIntakeEnvironment,
  BlueskyArchiveStagingArea,
} from "./ports";

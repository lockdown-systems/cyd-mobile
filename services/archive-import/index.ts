/**
 * Cyd Bluesky archive intake: reading a version 2 archive off the device into
 * verified, isolated staging, safely enough to survive a hostile file and a
 * terminated app.
 *
 * Intake stops at *prepared*. Merging staged data into a Bluesky local account
 * is a separate step, so nothing here can change a live account.
 */

export { ArchiveIntakeError, isArchiveIntakeError } from "./errors";
export type { ArchiveIntakeErrorCode } from "./errors";
export {
  createArchiveIntakeEnvironment,
  openArchiveByteReader,
} from "./environment";
export {
  cancelBlueskyArchiveIntake,
  listResumableBlueskyArchiveIntakes,
  runBlueskyArchiveIntake,
  stagedPayloadPath,
  DEFAULT_ARCHIVE_INTAKE_LIMITS,
} from "./intake";
export type {
  ArchiveIntakePhase,
  ArchiveIntakeProgress,
  BlueskyArchiveIntakeOutcome,
  PreparedBlueskyArchive,
  ResumableArchiveIntake,
  RunArchiveIntakeOptions,
} from "./intake";
export type { ArchiveIntakeLimits } from "./limits";
export type { ArchiveManifestPayload } from "./manifest";
export type {
  ArchiveByteReader,
  ArchiveIntakeEnvironment,
  ArchiveStagingArea,
} from "./ports";

/**
 * Failures that make a Cyd Bluesky archive unimportable.
 *
 * Every one of these is a decision to stop before anything leaves the staging
 * root, so the messages are written for the person holding the phone rather
 * than for a log file.
 */
export type ArchiveIntakeErrorCode =
  | "not-an-archive"
  | "unsupported-zip-feature"
  | "unsafe-entry-path"
  | "unsupported-entry-type"
  | "duplicate-entry"
  | "too-many-entries"
  | "manifest-missing"
  | "manifest-invalid"
  | "manifest-mismatch"
  | "metadata-missing"
  | "unsupported-archive"
  | "expansion-exceeded"
  | "size-mismatch"
  | "digest-mismatch"
  | "archive-too-large"
  | "insufficient-storage"
  | "corrupt-archive";

/**
 * An archive was rejected. Unlike an I/O failure, this is final: retrying the
 * same file cannot succeed, so the caller discards the staging area.
 */
export class ArchiveIntakeError extends Error {
  readonly code: ArchiveIntakeErrorCode;

  constructor(code: ArchiveIntakeErrorCode, message: string) {
    super(message);
    this.name = "ArchiveIntakeError";
    this.code = code;
  }
}

export function isArchiveIntakeError(error: unknown): error is ArchiveIntakeError {
  return error instanceof ArchiveIntakeError;
}

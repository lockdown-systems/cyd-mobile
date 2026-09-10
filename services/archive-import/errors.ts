/**
 * Failures that make a Cyd Bluesky archive unimportable.
 *
 * Every one of these is a decision to stop before anything leaves the staging
 * root, so the messages are written for the person holding the phone rather
 * than for a log file.
 */
export type BlueskyArchiveIntakeErrorCode =
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
 * An archive was rejected. Most of these are final -- retrying the same file
 * cannot succeed, so the caller discards the staging area. See
 * {@link isRetryableBlueskyArchiveIntakeFailure} for the exception.
 */
export class BlueskyArchiveIntakeError extends Error {
  readonly code: BlueskyArchiveIntakeErrorCode;

  constructor(code: BlueskyArchiveIntakeErrorCode, message: string) {
    super(message);
    this.name = "BlueskyArchiveIntakeError";
    this.code = code;
  }
}

/**
 * Codes that describe the device rather than the archive.
 *
 * Retrying the same file after freeing space can succeed, so a failure like
 * this must not take an import's staged progress down with it.
 */
export function isRetryableBlueskyArchiveIntakeFailure(code: BlueskyArchiveIntakeErrorCode): boolean {
  return code === "insufficient-storage";
}

/**
 * Raised when the person cancels part-way through, including mid-entry. It is
 * not an error about the archive, so it never reports a rejection.
 */
export class BlueskyArchiveIntakeCancelled extends Error {
  constructor() {
    super("The archive import was cancelled");
    this.name = "BlueskyArchiveIntakeCancelled";
  }
}

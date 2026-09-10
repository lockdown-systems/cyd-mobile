/**
 * Failures that stop a Cyd Bluesky archive export.
 *
 * Export is the one archive operation that cannot damage anything it reads:
 * every failure here ends with the staged working copy thrown away and the
 * Bluesky local account exactly as it was. So these are written as an
 * explanation of what Cyd could not produce, not as a warning about data loss.
 *
 * Note what is *not* here: a missing or unreadable media file is not an export
 * failure. It is an unavailable asset and an incomplete Cyd Bluesky archive,
 * which is the honest outcome the contract asks for.
 */
export type BlueskyArchiveExportErrorCode =
  /** The point-in-time snapshot of the account database could not be taken. */
  | "snapshot-failed"
  /** The staged snapshot is not the Bluesky account database it should be. */
  | "unreadable-snapshot"
  /** An asset's bytes changed between hashing and packaging. */
  | "asset-changed"
  /** A caller asked for an entry a Cyd Bluesky archive cannot contain. */
  | "invalid-entry"
  /** Beyond what a non-ZIP64 archive can address. */
  | "archive-too-large";

export class BlueskyArchiveExportError extends Error {
  readonly code: BlueskyArchiveExportErrorCode;

  constructor(code: BlueskyArchiveExportErrorCode, message: string) {
    super(message);
    this.name = "BlueskyArchiveExportError";
    this.code = code;
  }
}

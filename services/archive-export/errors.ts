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
  /**
   * The archive entry the failure is about, where there is one.
   *
   * `asset-changed` is the code an export can do something about: the entry
   * names the file that moved underneath it, so the attempt that follows can
   * call that one asset unavailable instead of giving up on the archive.
   */
  readonly entryPath: string | null;

  constructor(
    code: BlueskyArchiveExportErrorCode,
    message: string,
    entryPath: string | null = null,
  ) {
    super(message);
    this.name = "BlueskyArchiveExportError";
    this.code = code;
    this.entryPath = entryPath;
  }
}

/**
 * Raised when somebody walks away from an export part-way through.
 *
 * Not a failure: nothing was wrong with the account or the device, so it never
 * reports a reason. What it does mean is that the staged work is not coming
 * back — cancelling takes the staging with it, unlike an interruption, which
 * keeps it precisely so the next launch can carry on.
 */
export class BlueskyArchiveExportCancelled extends Error {
  constructor() {
    super("The archive export was cancelled");
    this.name = "BlueskyArchiveExportCancelled";
  }
}

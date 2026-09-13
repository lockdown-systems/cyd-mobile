/**
 * Why a prepared Cyd Bluesky archive could not be merged.
 *
 * Intake has proved the package intact (#95) and the shared version 2 adapter
 * raises what it thinks of the interchange database, so what is left here is
 * about destinations: an archive pointed at the wrong Bluesky local account,
 * or a database holding one Bluesky identity twice, which Mobile's schema does
 * not allow and which therefore has no destination at all. The messages are
 * written for the person holding the phone.
 */
export type BlueskyArchiveMergeErrorCode =
  | "identity-mismatch"
  | "duplicate-identity";

export class BlueskyArchiveMergeError extends Error {
  readonly code: BlueskyArchiveMergeErrorCode;

  constructor(code: BlueskyArchiveMergeErrorCode, message: string) {
    super(message);
    this.name = "BlueskyArchiveMergeError";
    this.code = code;
  }
}

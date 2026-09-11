/**
 * Why a prepared Cyd Bluesky archive could not become a Bluesky local account.
 *
 * Intake has already proved the package is well-formed and intact (#95), so
 * nothing here is about ZIP structure or digests. What is left is what the
 * archive *means*: an interchange database Cyd cannot read, an identity this
 * installation already has, or storage that would not take the restored
 * account. The messages are written for the person holding the phone.
 */
export type BlueskyArchiveRestoreErrorCode =
  | "unreadable-interchange"
  | "unsupported-interchange"
  | "account-exists"
  | "storage-failed";

export class BlueskyArchiveRestoreError extends Error {
  readonly code: BlueskyArchiveRestoreErrorCode;

  constructor(code: BlueskyArchiveRestoreErrorCode, message: string) {
    super(message);
    this.name = "BlueskyArchiveRestoreError";
    this.code = code;
  }
}

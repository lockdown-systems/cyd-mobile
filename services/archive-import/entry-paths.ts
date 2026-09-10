/**
 * Path safety for the ZIP entries inside a Cyd Bluesky archive.
 *
 * A ZIP entry name is attacker-controlled data. Everything a Bluesky archive
 * import writes goes through {@link checkZipEntryPath} first, so an entry
 * can only ever land at a relative, already-normalized location inside the
 * staging root. Names are rejected rather than repaired: a normalizer that
 * quietly rewrites `../` hides the fact that the archive tried to escape.
 */

import { BlueskyArchiveIntakeError } from "./errors";

/** Longest entry path we accept, in UTF-16 code units. */
export const MAX_ENTRY_PATH_LENGTH = 512;

export type ZipEntryPathCheck =
  | { ok: true; path: string; isDirectory: boolean }
  | { ok: false; reason: string };

/** Matches `C:`, `c:/`, and other DOS drive prefixes. */
const DRIVE_LETTER_PATTERN = /^[A-Za-z]:/;

function reject(reason: string): ZipEntryPathCheck {
  return { ok: false, reason };
}

/**
 * Decode a raw ZIP entry name as strict UTF-8.
 *
 * Returns null when the bytes are not valid UTF-8. Lenient decoding would
 * replace bad bytes with U+FFFD, which means two different entry names can
 * collapse into one and slip past the duplicate-entry check.
 */
export function decodeZipEntryName(bytes: Uint8Array): string | null {
  const decoded = new TextDecoder("utf-8").decode(bytes);
  return decoded.includes("\uFFFD") ? null : decoded;
}

/**
 * Check that an entry name is safe to use as a staging-relative path.
 *
 * Directory entries (a trailing `/`) are reported through `isDirectory` with
 * the slash stripped; callers skip them rather than creating them eagerly.
 */
export function checkZipEntryPath(rawName: string): ZipEntryPathCheck {
  if (rawName.length === 0) {
    return reject("The archive contains an entry with an empty path.");
  }
  if (rawName.length > MAX_ENTRY_PATH_LENGTH) {
    return reject("The archive contains an entry path that is too long.");
  }
  for (const character of rawName) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return reject("The archive contains an entry path with a control character.");
    }
  }
  if (rawName.includes("\\")) {
    return reject("The archive contains an entry path with a backslash.");
  }
  if (rawName.startsWith("/") || DRIVE_LETTER_PATTERN.test(rawName)) {
    return reject("The archive contains an absolute entry path.");
  }

  const isDirectory = rawName.endsWith("/");
  const path = isDirectory ? rawName.slice(0, -1) : rawName;
  const segments = path.split("/");

  if (segments.some((segment) => segment === ".." )) {
    return reject("The archive contains an entry path that traverses outside it.");
  }
  if (segments.some((segment) => segment === "" || segment === ".")) {
    return reject("The archive contains an entry path that is not normalized.");
  }

  return { ok: true, path, isDirectory };
}

/**
 * The gate in front of every staging write: return the path, or refuse.
 *
 * Both the manifest reader and the staging area itself go through this, so a
 * path that reached one of them without passing the ZIP reader's checks still
 * cannot escape.
 */
export function requireStagedFilePath(path: string): string {
  const check = checkZipEntryPath(path);
  if (!check.ok) {
    throw new BlueskyArchiveIntakeError("unsafe-entry-path", check.reason);
  }
  if (check.isDirectory) {
    throw new BlueskyArchiveIntakeError(
      "unsafe-entry-path",
      `A directory cannot be used as an archive payload: ${path}`,
    );
  }
  return check.path;
}

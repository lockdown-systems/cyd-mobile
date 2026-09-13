import type { LocalAccountIdentity } from "@/services/archive-restore";

import { BlueskyArchiveMergeError } from "./errors";

/**
 * Where a picked Cyd Bluesky archive is committed.
 *
 * Routing a Cyd Bluesky archive and merging one are the same decision, taken
 * once: intake reports the Bluesky identity's DID (#95), and whether this
 * installation already holds that identity decides everything that follows.
 * Nothing here reads the archive's contents, and nothing matches on a handle
 * or a local-account UUID — a handle moves between identities, and a UUID is
 * this installation's own name for one.
 */
export type BlueskyArchiveImportDestination =
  /** No Bluesky local account for this identity: restore a new one (#96). */
  | { kind: "restore" }
  /** Exactly one holds it: the archive is a recovery union into that account. */
  | { kind: "merge"; account: LocalAccountIdentity };

export function chooseBlueskyArchiveImportDestination(
  archiveDid: string,
  existing: LocalAccountIdentity[],
): BlueskyArchiveImportDestination {
  const holders = existing.filter((account) => account.did === archiveDid);

  if (holders.length === 0) {
    return { kind: "restore" };
  }
  if (holders.length > 1) {
    // `bsky_account.did` is unique and has been since the column existed, so
    // this cannot happen to a database Cyd Mobile built. If one ever turns up
    // holding an identity twice, the archive has no unambiguous destination
    // and saying so beats merging into whichever came back first.
    throw new BlueskyArchiveMergeError(
      "duplicate-identity",
      "This device has more than one Bluesky account for the identity in this archive, so Cyd cannot tell where to import it.",
    );
  }
  return { kind: "merge", account: holders[0] };
}

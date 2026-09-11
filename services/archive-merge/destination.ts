import type { LocalAccountIdentity } from "@/services/archive-restore";

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
  | { kind: "merge"; account: LocalAccountIdentity }
  /**
   * Several hold it, so there is no unambiguous destination. The duplicates
   * are reconciled into one surviving Bluesky local account first (ADR 0011).
   */
  | { kind: "reconcile"; did: string; accounts: LocalAccountIdentity[] };

export function chooseBlueskyArchiveImportDestination(
  archiveDid: string,
  existing: LocalAccountIdentity[],
): BlueskyArchiveImportDestination {
  const holders = existing.filter((account) => account.did === archiveDid);

  if (holders.length === 0) {
    return { kind: "restore" };
  }
  if (holders.length === 1) {
    return { kind: "merge", account: holders[0] };
  }
  return { kind: "reconcile", did: archiveDid, accounts: holders };
}

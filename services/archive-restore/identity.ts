import { BlueskyArchiveRestoreError } from "./errors";

/**
 * Which local-account UUID the restored Bluesky local account gets.
 *
 * A Cyd Bluesky archive carries the UUID the exporting installation used, and
 * keeping it is what lets the same identity look like the same account across
 * clients. It is a preference rather than a guarantee: a UUID already held by
 * a *different* Bluesky identity must not be reused, because the two accounts
 * would then be one. In that case Cyd remaps and says so (ADR 0011).
 *
 * Matching is by DID, never by handle or UUID. An identity this installation
 * already knows is not a restore at all — it is the recovery merge #97 owns —
 * so it is refused here rather than quietly turned into a second account for
 * the same person.
 */

export type LocalAccountIdentity = {
  uuid: string;
  did: string | null;
  handle: string | null;
};

export type RestoredUuidRemapping = {
  archiveUuid: string;
  assignedUuid: string;
  reason: string;
};

export type ChosenRestoredAccountUuid = {
  uuid: string;
  remapping: RestoredUuidRemapping | null;
};

export function chooseRestoredAccountUuid(options: {
  archiveUuid: string;
  archiveDid: string;
  existing: LocalAccountIdentity[];
  newUuid: () => string;
}): ChosenRestoredAccountUuid {
  const { archiveUuid, archiveDid, existing, newUuid } = options;

  const sameIdentity = existing.find((account) => account.did === archiveDid);
  if (sameIdentity) {
    throw new BlueskyArchiveRestoreError(
      "account-exists",
      "This device already has a Bluesky account for that identity, so the archive would be merged into it rather than restored as a new one.",
    );
  }

  const taken = new Set(existing.map((account) => account.uuid));
  if (!taken.has(archiveUuid)) {
    return { uuid: archiveUuid, remapping: null };
  }

  let assignedUuid = newUuid();
  while (taken.has(assignedUuid)) {
    assignedUuid = newUuid();
  }
  return {
    uuid: assignedUuid,
    remapping: {
      archiveUuid,
      assignedUuid,
      reason:
        "Another Bluesky account on this device already uses the identifier this archive carries, so Cyd gave the restored account a new one.",
    },
  };
}

/**
 * Which handle the restored Bluesky local account is listed under.
 *
 * Mobile requires a handle and keeps them unique, and Bluesky handles move
 * between identities: somebody who renamed and re-registered can hold an
 * archive whose handle another local account is already listed under. The DID
 * is the identity either way (ADR 0011), so the restored account falls back to
 * it rather than failing, or quietly taking a name that belongs to somebody
 * else's account.
 */
export function chooseRestoredAccountHandle(options: {
  archiveHandle: string;
  archiveDid: string;
  existing: LocalAccountIdentity[];
}): string {
  const taken = options.existing.some(
    (account) => account.handle === options.archiveHandle,
  );
  return taken ? options.archiveDid : options.archiveHandle;
}

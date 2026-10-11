import { BlueskyArchiveRestoreError } from "./errors";

/**
 * Refuse an identity this installation already holds.
 *
 * Matching is by DID, never by handle or UUID. An identity Cyd already knows
 * is not a restore at all — it is the recovery merge #97 owns — so it is
 * stopped here rather than quietly turned into a second Bluesky local account
 * for the same person.
 */
export function requireUnknownIdentity(
  archiveDid: string,
  existing: LocalAccountIdentity[],
): void {
  if (existing.some((account) => account.did === archiveDid)) {
    throw new BlueskyArchiveRestoreError(
      "account-exists",
      "This device already has a Bluesky account for that identity, so the archive would be merged into it rather than restored as a new one.",
    );
  }
}

/**
 * Which local-account UUID the restored Bluesky local account gets.
 *
 * Keeping the archive's UUID lets the same identity look like the same account
 * across clients, but a UUID already held by a *different* Bluesky identity
 * must not be reused — in that case Cyd remaps and says so.
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
  existing: LocalAccountIdentity[];
  newUuid: () => string;
}): ChosenRestoredAccountUuid {
  const { archiveUuid, existing, newUuid } = options;

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
 * Bluesky handles move between identities, so the archive's handle may already
 * be taken. The DID is the identity either way, so the restored account falls
 * back to it rather than failing.
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

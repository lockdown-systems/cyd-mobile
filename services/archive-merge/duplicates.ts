import type { LocalAccountIdentity } from "@/services/archive-restore";

import { readExistingAccountRows } from "./account-rows";
import { BlueskyArchiveMergeError } from "./errors";
import {
  planBlueskyArchiveMerge,
  type BlueskyArchiveMergeSummary,
} from "./merge-plan";
import { countPlannedWrites, writeMergedAccountRows } from "./merge-writer";
import type {
  BlueskyArchiveMergeEnvironment,
  ReconcilableAccountSettings,
} from "./ports";
import type { ExistingAccountRows } from "./rows";

/**
 * Collapsing a Bluesky identity this installation holds more than once.
 *
 * A migration, a restore that went sideways, or two people sharing a phone can
 * leave one DID with several Bluesky local accounts, and then an archive
 * import has no unambiguous destination. Cyd does not pick one: it shows what
 * each account holds and what each is set to do, and the person says which
 * local-account UUID survives and whose settings it keeps (ADR 0011).
 *
 * What happens afterwards is the same union an archive import performs — the
 * surviving account ends up holding everything all of them held — followed by
 * the removal of the others, which is what leaves one Bluesky local account
 * per identity for imports to aim at.
 */

export type DuplicateBlueskyIdentity = {
  did: string;
  accounts: LocalAccountIdentity[];
};

export type DuplicateAccountCounts = {
  posts: number;
  bookmarks: number;
  follows: number;
  chats: number;
  messages: number;
  profiles: number;
  media: number;
};

export type DuplicateAccountPreview = {
  uuid: string;
  handle: string | null;
  counts: DuplicateAccountCounts;
  settings: ReconcilableAccountSettings;
};

export type DuplicateReconciliationPreview = {
  did: string;
  accounts: DuplicateAccountPreview[];
};

export type DuplicateReconciliationChoice = {
  did: string;
  /** Every Bluesky local account this installation has, as routing saw them. */
  accounts: LocalAccountIdentity[];
  /** The local-account UUID the person chose to keep. */
  survivingUuid: string;
  /** Whose Bluesky account settings and schedule the survivor keeps. */
  settingsFromUuid: string;
};

export type DuplicateReconciliationResult = {
  did: string;
  survivingUuid: string;
  removedUuids: string[];
  /** Rows the survivor gained, by table, across all the accounts it absorbed. */
  summary: BlueskyArchiveMergeSummary[];
  written: number;
};

/** Every DID this installation holds more than one Bluesky local account for. */
export function findDuplicateBlueskyIdentities(
  accounts: LocalAccountIdentity[],
): DuplicateBlueskyIdentity[] {
  const byDid = new Map<string, LocalAccountIdentity[]>();
  for (const account of accounts) {
    if (account.did === null) {
      // An account with no DID is not a duplicate of anything: nothing can say
      // which Bluesky identity it is.
      continue;
    }
    byDid.set(account.did, [...(byDid.get(account.did) ?? []), account]);
  }

  return [...byDid.entries()]
    .filter(([, holders]) => holders.length > 1)
    .map(([did, holders]) => ({ did, accounts: holders }));
}

/**
 * What each of the duplicates holds, so somebody can tell them apart.
 *
 * Counts rather than a diff: the union means nothing is lost whichever they
 * keep, so the question in front of them is which account they recognise as
 * theirs and which settings they want to carry on with.
 */
export async function previewDuplicateReconciliation(
  environment: BlueskyArchiveMergeEnvironment,
  identity: DuplicateBlueskyIdentity,
): Promise<DuplicateReconciliationPreview> {
  const holders = holdersOf(identity.did, identity.accounts);
  const accounts: DuplicateAccountPreview[] = [];

  for (const account of holders) {
    accounts.push({
      uuid: account.uuid,
      handle: account.handle,
      counts: countRows(await readAccount(environment, account.uuid)),
      settings: await environment.readAccountSettings(account.uuid),
    });
  }

  return { did: identity.did, accounts };
}

/**
 * Carry out the choice: one surviving Bluesky local account, holding the union.
 *
 * Each duplicate is merged in whole — its rows through the same union rules an
 * archive import uses, its media files copied into the survivor's own storage
 * so the surviving rows point at files that will still be there — and then
 * removed. Nothing is deleted before its data has landed, so a reconciliation
 * that fails part way leaves the account it was reading from intact.
 */
export async function reconcileDuplicateBlueskyAccounts(
  environment: BlueskyArchiveMergeEnvironment,
  choice: DuplicateReconciliationChoice,
): Promise<DuplicateReconciliationResult> {
  const holders = holdersOf(choice.did, choice.accounts);
  requireHolder(holders, choice.survivingUuid, "keep");
  requireHolder(holders, choice.settingsFromUuid, "take settings from");

  const doomed = holders.filter(
    (account) => account.uuid !== choice.survivingUuid,
  );
  const settings = await environment.readAccountSettings(
    choice.settingsFromUuid,
  );

  const summary: BlueskyArchiveMergeSummary[] = [];
  let written = 0;

  for (const account of doomed) {
    const incoming = await adoptMedia(
      environment,
      account.uuid,
      choice.survivingUuid,
      await readAccount(environment, account.uuid),
    );

    const survivor = await environment.openAccountDatabase(
      choice.survivingUuid,
    );
    try {
      const plan = planBlueskyArchiveMerge(
        await readExistingAccountRows(survivor),
        incoming,
      );
      await survivor.transaction(async () => {
        await writeMergedAccountRows(survivor, plan);
      });
      summary.push(plan.summary);
      written += countPlannedWrites(plan);
    } finally {
      await survivor.close();
    }
  }

  // Settings are applied before the losing accounts go, so a failure here is
  // recoverable: the accounts are still there to choose between.
  await environment.applyAccountSettings(choice.survivingUuid, settings);

  for (const account of doomed) {
    await environment.removeLocalAccount({
      accountId: null,
      accountUuid: account.uuid,
    });
  }

  // With one Bluesky local account left for the identity, the rule that there
  // can only be one goes back on, so a later archive import has somewhere
  // unambiguous to land (ADR 0011).
  await environment.enforceOneAccountPerDid();

  return {
    did: choice.did,
    survivingUuid: choice.survivingUuid,
    removedUuids: doomed.map((account) => account.uuid),
    summary,
    written,
  };
}

function holdersOf(
  did: string,
  accounts: LocalAccountIdentity[],
): LocalAccountIdentity[] {
  const holders = accounts.filter((account) => account.did === did);
  if (holders.length < 2) {
    throw new BlueskyArchiveMergeError(
      "duplicate-identity",
      "This device no longer has more than one Bluesky account for that identity.",
    );
  }
  return holders;
}

function requireHolder(
  holders: LocalAccountIdentity[],
  uuid: string,
  intent: string,
): void {
  if (!holders.some((account) => account.uuid === uuid)) {
    throw new BlueskyArchiveMergeError(
      "unknown-account",
      `The Bluesky account Cyd was asked to ${intent} is not one of the accounts being reconciled.`,
    );
  }
}

async function readAccount(
  environment: BlueskyArchiveMergeEnvironment,
  accountUuid: string,
): Promise<ExistingAccountRows> {
  const database = await environment.openAccountDatabase(accountUuid);
  try {
    return await readExistingAccountRows(database);
  } finally {
    await database.close();
  }
}

/**
 * Bring a duplicate's media files across before its rows point at them.
 *
 * A row is only worth anything if the file it names is still readable after
 * the account it belonged to is gone. A file that has already vanished leaves
 * the row as a failed download with its source URL, which is what Cyd would
 * have held if the download had never succeeded.
 */
async function adoptMedia(
  environment: BlueskyArchiveMergeEnvironment,
  sourceAccountUuid: string,
  targetAccountUuid: string,
  rows: ExistingAccountRows,
): Promise<ExistingAccountRows> {
  const moved = new Map<string, string | null>();

  const relocate = async (localPath: string | null): Promise<string | null> => {
    if (localPath === null) {
      return null;
    }
    if (!moved.has(localPath)) {
      const stored = await environment.adoptAccountMedia(
        sourceAccountUuid,
        targetAccountUuid,
        localPath,
      );
      moved.set(localPath, stored?.uri ?? null);
    }
    return moved.get(localPath) ?? null;
  };

  const mediaAssets: ExistingAccountRows["mediaAssets"] = [];
  for (const asset of rows.mediaAssets) {
    const localPath = await relocate(asset.localPath);
    mediaAssets.push(
      localPath === null && asset.localPath !== null
        ? {
            ...asset,
            localPath: null,
            downloadState: "failed",
            lastError: "The copy of this file went missing when Cyd merged two accounts for the same Bluesky identity.",
            downloadedAt: null,
          }
        : { ...asset, localPath },
    );
  }

  const postExternals: ExistingAccountRows["postExternals"] = [];
  for (const external of rows.postExternals) {
    postExternals.push({
      ...external,
      thumbLocalPath: await relocate(external.thumbLocalPath),
    });
  }

  const profiles: ExistingAccountRows["profiles"] = [];
  for (const profile of rows.profiles) {
    // Avatars are stored as URLs, and a restored one points into the account's
    // own storage, so it has to move with everything else.
    const isLocal = profile.avatarUrl?.startsWith("file://") === true;
    profiles.push(
      isLocal
        ? { ...profile, avatarUrl: await relocate(profile.avatarUrl) }
        : profile,
    );
  }

  return { ...rows, mediaAssets, postExternals, profiles };
}

function countRows(rows: ExistingAccountRows): DuplicateAccountCounts {
  return {
    posts: rows.posts.length,
    bookmarks: rows.bookmarks.length,
    follows: rows.follows.length,
    chats: rows.conversations.length,
    messages: rows.messages.length,
    profiles: rows.profiles.length,
    media: rows.mediaAssets.length,
  };
}

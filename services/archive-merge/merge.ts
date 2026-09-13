import {
  placeArchivedMedia,
  predictArchivedMedia,
  readBlueskyInterchange,
  translateInterchangeToMobileRows,
  type BlueskyInterchangeSnapshot,
  type InterchangeAsset,
  type LocalAccountIdentity,
  type RestoredMobileAccount,
  type UnrestorableContent,
} from "@/services/archive-restore";

import { readExistingAccountRows } from "./account-rows";
import { accountRowsFromArchive } from "./rows";
import { BlueskyArchiveMergeError } from "./errors";
import {
  planBlueskyArchiveMerge,
  type BlueskyArchiveMergePlan,
  type BlueskyArchiveMergeSummary,
} from "./merge-plan";
import { countPlannedWrites, writeMergedAccountRows } from "./merge-writer";
import type {
  BlueskyArchiveMergeEnvironment,
  PreparedArchiveLocation,
} from "./ports";

/**
 * The commit half of a Bluesky archive import for an identity Cyd already
 * holds.
 *
 * It runs in two acts, and the split is the point. A **preview** reads the
 * prepared archive and works out exactly what merging it would do, touching
 * nothing; a **commit** takes that preview and carries it out. Somebody is
 * shown the preview first because a recovery merge can bring back records they
 * deleted from Cyd on purpose, and nobody should find that out afterwards.
 *
 * Everything else follows the restore's shape (#96): media is copied in before
 * rows are written, so a record's local file path is known when its row is
 * built, and an asset that will not copy becomes a failed download rather than
 * a failed import.
 */

export type BlueskyArchiveMergePhase =
  | "reading"
  | "merging-media"
  | "writing"
  | "done";

export type BlueskyArchiveMergeProgress = {
  phase: BlueskyArchiveMergePhase;
  mergedAssets: number;
  totalAssets: number;
};

export type BlueskyArchiveMergeRequest = {
  /** An archive intake that ended *prepared* (#95). */
  archive: PreparedArchiveLocation;
  /** The Bluesky local account holding this archive's identity. */
  account: LocalAccountIdentity;
  onProgress?: (progress: BlueskyArchiveMergeProgress) => void;
};

export type MergedAssetSummary = {
  total: number;
  merged: number;
  missing: number;
};

export type BlueskyArchiveMergePreview = {
  accountUuid: string;
  accountDid: string;
  /** What the archive says about itself, for somebody deciding about it. */
  archive: {
    createdAt: string;
    completeness: "complete" | "incomplete";
    accountUuid: string;
  };
  summary: BlueskyArchiveMergeSummary;
  assets: MergedAssetSummary;
  unrestorable: UnrestorableContent;
  /** Everything the commit needs, so agreeing to a preview commits that archive. */
  readonly source: {
    location: PreparedArchiveLocation;
    snapshot: BlueskyInterchangeSnapshot;
  };
};

export type BlueskyArchiveMergeResult = {
  accountUuid: string;
  accountDid: string;
  /** Rows actually written. Zero is what a repeated import looks like. */
  written: number;
  summary: BlueskyArchiveMergeSummary;
  assets: MergedAssetSummary;
};

/**
 * Work out what merging this archive would do, without doing any of it.
 *
 * Media is not copied yet, so the plan is built against where each file *will*
 * live: the paths are content-addressed, so they are known before the bytes
 * move (ADR 0007). A file that then refuses to copy is downgraded at commit
 * time, which can only ever turn a restored asset into a failed download.
 */
export async function previewBlueskyArchiveMerge(
  environment: BlueskyArchiveMergeEnvironment,
  request: BlueskyArchiveMergeRequest,
): Promise<BlueskyArchiveMergePreview> {
  const report = reporter(request);
  report("reading", 0, 0);

  const archive = environment.openPreparedArchive(request.archive);
  const interchange = await archive.openInterchange();
  let snapshot: BlueskyInterchangeSnapshot;
  try {
    snapshot = await readBlueskyInterchange(interchange);
  } finally {
    await interchange.close();
  }

  requireMatchingIdentity(snapshot.archive.account_did, request.account);

  const incoming = translateInterchangeToMobileRows(snapshot, {
    placements: predictArchivedMedia(snapshot.assets, (fileName) =>
      environment.accountMediaUri(request.account.uuid, fileName),
    ),
  });
  const plan = await planAgainstAccount(
    environment,
    request.account.uuid,
    snapshot.archive.account_did,
    incoming,
  );

  report("done", 0, snapshot.assets.length);
  return {
    accountUuid: request.account.uuid,
    accountDid: snapshot.archive.account_did,
    archive: {
      createdAt: snapshot.archive.created_at,
      completeness: snapshot.archive.completeness,
      accountUuid: snapshot.archive.account_uuid,
    },
    summary: plan.summary,
    assets: summarizeAssets(snapshot.assets),
    unrestorable: incoming.unrestorable,
    source: { location: request.archive, snapshot },
  };
}

/**
 * Carry out a preview somebody agreed to.
 *
 * The account is read again rather than trusted from the preview: a save that
 * ran in between is newer than the archive, and the union rules can only reach
 * the right answer if they are given what the account holds *now*. Committing
 * twice is therefore as safe as importing twice — the second commit finds
 * nothing left to write.
 */
export async function commitBlueskyArchiveMerge(
  environment: BlueskyArchiveMergeEnvironment,
  preview: BlueskyArchiveMergePreview,
  options: { onProgress?: (progress: BlueskyArchiveMergeProgress) => void } = {},
): Promise<BlueskyArchiveMergeResult> {
  const { snapshot, location } = preview.source;
  const totalAssets = snapshot.assets.length;
  const report = reporter({ onProgress: options.onProgress });

  const archive = environment.openPreparedArchive(location);

  report("merging-media", 0, totalAssets);
  const placements = await placeArchivedMedia(environment, {
    accountUuid: preview.accountUuid,
    archive,
    assets: snapshot.assets,
    onPlaced: (placed) => report("merging-media", placed, totalAssets),
  });

  const incoming = translateInterchangeToMobileRows(snapshot, { placements });
  const plan = await planAgainstAccount(
    environment,
    preview.accountUuid,
    preview.accountDid,
    incoming,
  );

  report("writing", placements.size, totalAssets);
  const database = await environment.openAccountDatabase(preview.accountUuid);
  try {
    await database.transaction(async () => {
      await writeMergedAccountRows(database, plan);
    });
  } finally {
    await database.close();
  }

  // The account holds everything the archive carried, so the staged copy is
  // nothing but a second copy of data this device now has.
  await archive.discard();

  report("done", placements.size, totalAssets);
  return {
    accountUuid: preview.accountUuid,
    accountDid: preview.accountDid,
    written: countPlannedWrites(plan),
    summary: plan.summary,
    assets: summarizeAssets(snapshot.assets),
  };
}

function reporter(options: {
  onProgress?: (progress: BlueskyArchiveMergeProgress) => void;
}) {
  return (
    phase: BlueskyArchiveMergePhase,
    mergedAssets: number,
    totalAssets: number,
  ): void => options.onProgress?.({ phase, mergedAssets, totalAssets });
}

async function planAgainstAccount(
  environment: BlueskyArchiveMergeEnvironment,
  accountUuid: string,
  accountDid: string,
  incoming: RestoredMobileAccount,
): Promise<BlueskyArchiveMergePlan> {
  const database = await environment.openAccountDatabase(accountUuid);
  try {
    return planBlueskyArchiveMerge(
      await readExistingAccountRows(database),
      accountRowsFromArchive(incoming),
      accountDid,
    );
  } finally {
    await database.close();
  }
}

/**
 * Refuse an archive that belongs to somebody else.
 *
 * The DID is the identity (ADR 0011), so this is the only check worth making:
 * a handle that matches proves nothing, and a handle that does not is routine
 * for somebody who renamed.
 */
function requireMatchingIdentity(
  archiveDid: string,
  account: LocalAccountIdentity,
): void {
  if (account.did !== archiveDid) {
    throw new BlueskyArchiveMergeError(
      "identity-mismatch",
      "This archive belongs to a different Bluesky identity than the account it was about to be merged into.",
    );
  }
}

/**
 * What the archive's media amounts to for this account.
 *
 * An asset the account already holds is not counted as missing: the file is
 * there, and the merge simply had nothing to change about it.
 */
function summarizeAssets(assets: InterchangeAsset[]): MergedAssetSummary {
  const available = assets.filter(
    (asset) => asset.availability === "available" && asset.sha256,
  ).length;
  return {
    total: assets.length,
    merged: available,
    missing: assets.length - available,
  };
}

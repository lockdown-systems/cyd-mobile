import { ACCOUNT_AUTH_STATUS, ACCOUNT_CONFIG_KEYS } from "@/controllers/config";

import {
  chooseRestoredAccountHandle,
  chooseRestoredAccountUuid,
  requireUnknownIdentity,
  type RestoredUuidRemapping,
} from "./identity";
import {
  readBlueskyInterchange,
  type BlueskyInterchangeSnapshot,
  type InterchangeAsset,
} from "./interchange-reader";
import {
  translateInterchangeToMobileRows,
  type RestoredAssetPlacement,
  type RestoredMobileAccount,
  type UnrestorableContent,
} from "./mobile-rows";
import { accountSettingsFromPortableSettings } from "./portable-settings";
import type {
  BlueskyArchiveRestoreEnvironment,
  CreatedLocalAccount,
  PreparedArchiveLocation,
  PreparedArchiveStore,
  RestoredAccountDatabase,
  StoredMediaFile,
} from "./ports";
import { writeRestoredAccountRows } from "./account-writer";

/**
 * Turning a prepared Cyd Bluesky archive into a Bluesky local account somebody
 * can browse on a plane.
 *
 * The order of the four steps is the design:
 *
 * 1. **Read** — pull the whole interchange database into memory and check it
 *    is a version 2 Bluesky archive at all. Nothing has been created yet.
 * 2. **Place media** — copy each packaged asset into the account's own media
 *    storage, once per file (ADR 0007). An asset that will not copy becomes a
 *    failed download rather than a failed restore.
 * 3. **Translate** — turn the interchange rows into Mobile's private ones,
 *    now that every asset's local path is known (ADR 0002).
 * 4. **Commit** — create the Bluesky local account and write its database in
 *    one transaction.
 *
 * The account is created disconnected and stays that way: no Bluesky
 * connection, no schedule, and nothing here needs the network or a premium
 * subscription. If any step fails, the half-restored account and its media are
 * removed, so an installation is either unchanged or holds a whole account.
 */

export type BlueskyArchiveRestorePhase =
  | "reading"
  | "restoring-media"
  | "writing"
  | "done";

export type BlueskyArchiveRestoreProgress = {
  phase: BlueskyArchiveRestorePhase;
  restoredAssets: number;
  totalAssets: number;
};

export type BlueskyArchiveRestoreRequest = {
  /** An archive intake that ended *prepared* (#95). */
  archive: PreparedArchiveLocation;
  onProgress?: (progress: BlueskyArchiveRestoreProgress) => void;
};

export type RestoredCategoryCounts = {
  posts: number;
  reposts: number;
  likes: number;
  bookmarks: number;
  chats: number;
  messages: number;
  profiles: number;
  follows: number;
};

export type RestoredAssetSummary = {
  total: number;
  restored: number;
  missing: number;
};

export type BlueskyArchiveRestoreResult = {
  accountId: number;
  accountUuid: string;
  accountDid: string;
  handle: string;
  /** Set when the archive's own UUID was already taken (ADR 0011). */
  uuidRemapping: RestoredUuidRemapping | null;
  /** What the archive said about itself, preserved on the restored account. */
  completeness: "complete" | "incomplete";
  counts: RestoredCategoryCounts;
  assets: RestoredAssetSummary;
  unrestorable: UnrestorableContent;
};

/** Content-addressed name of a restored file inside the account's media store. */
export function restoredMediaFileName(sha256: string): string {
  return `sha256-${sha256}`;
}

export async function restoreBlueskyArchiveAccount(
  environment: BlueskyArchiveRestoreEnvironment,
  request: BlueskyArchiveRestoreRequest,
): Promise<BlueskyArchiveRestoreResult> {
  const archive = environment.openPreparedArchive(request.archive);
  const report = (
    phase: BlueskyArchiveRestorePhase,
    restoredAssets: number,
    totalAssets: number,
  ): void =>
    request.onProgress?.({ phase, restoredAssets, totalAssets });

  report("reading", 0, 0);
  const interchange = await archive.openInterchange();
  let snapshot: BlueskyInterchangeSnapshot;
  try {
    snapshot = await readBlueskyInterchange(interchange);
  } finally {
    await interchange.close();
  }

  const existing = await environment.listLocalAccountIdentities();
  requireUnknownIdentity(snapshot.archive.account_did, existing);
  const { uuid: accountUuid, remapping } = chooseRestoredAccountUuid({
    archiveUuid: snapshot.archive.account_uuid,
    existing,
    newUuid: environment.newUuid,
  });

  let account: CreatedLocalAccount | null = null;
  try {
    report("restoring-media", 0, snapshot.assets.length);
    const placements = await placeArchivedMedia(environment, {
      accountUuid,
      archive,
      assets: snapshot.assets,
      onPlaced: (placed) =>
        report("restoring-media", placed, snapshot.assets.length),
    });

    const restored = translateInterchangeToMobileRows(snapshot, { placements });

    report("writing", placements.size, snapshot.assets.length);
    const handle = chooseRestoredAccountHandle({
      archiveHandle: restored.identity.handle,
      archiveDid: restored.identity.did,
      existing,
    });
    account = await environment.createLocalAccount({
      uuid: accountUuid,
      did: restored.identity.did,
      handle,
      displayName: restored.identity.displayName,
      avatarUrl: restored.identity.avatarUrl,
      settings: accountSettingsFromPortableSettings(snapshot.portableSettings),
    });

    const database = await environment.openAccountDatabase(accountUuid);
    try {
      await database.transaction(async () => {
        await writeRestoredAccountRows(database, restored);
        await writeRestoreConfig(database, snapshot);
      });
    } finally {
      await database.close();
    }

    // The account is committed, so the staged copy of the archive is nothing
    // but a second copy of data this device now holds.
    await archive.discard();

    report("done", placements.size, snapshot.assets.length);
    return {
      accountId: account.accountId,
      accountUuid: account.accountUuid,
      accountDid: restored.identity.did,
      handle,
      uuidRemapping: remapping,
      completeness: restored.completeness,
      counts: countRestored(restored),
      assets: summarizeAssets(placements, snapshot.assets.length),
      unrestorable: restored.unrestorable,
    };
  } catch (error) {
    // A restore that failed leaves nothing worth keeping, and the installation
    // it was running on has to look exactly as it did beforehand. Media is
    // copied into the account's own directory, so discarding the account takes
    // the half-restored files with it even when the account row was never
    // created.
    await environment.discardLocalAccount(
      account ?? { accountId: null, accountUuid },
    );
    throw error;
  }
}

/**
 * Copy each packaged asset into the Bluesky local account, once per file.
 *
 * An asset the archive marked unavailable never had bytes to copy. One that
 * will not read, or that arrives the wrong size, is treated the same way: the
 * archive's promise about that file did not hold, and calling it restored
 * would make an incomplete backup look complete. Either way the record keeps
 * its reference and the source URL, so saving can fetch it later.
 */
async function placeArchivedMedia(
  environment: BlueskyArchiveRestoreEnvironment,
  options: {
    accountUuid: string;
    archive: Pick<PreparedArchiveStore, "readPayload">;
    assets: InterchangeAsset[];
    onPlaced: (placed: number) => void;
  },
): Promise<Map<string, RestoredAssetPlacement>> {
  const placements = new Map<string, RestoredAssetPlacement>();
  const byDigest = new Map<string, string>();
  let placed = 0;

  for (const asset of options.assets) {
    if (asset.availability !== "available" || !asset.archive_path || !asset.sha256) {
      placements.set(asset.id, {
        assetId: asset.id,
        availability: "missing",
        reason:
          asset.unavailable_reason ??
          "This file was not included in the archive.",
      });
      continue;
    }

    const alreadyPlaced = byDigest.get(asset.sha256);
    if (alreadyPlaced) {
      placements.set(asset.id, {
        assetId: asset.id,
        availability: "restored",
        localPath: alreadyPlaced,
      });
      continue;
    }

    const archivePath = asset.archive_path;
    let stored: StoredMediaFile | null = null;
    try {
      stored = await environment.storeAccountMedia(
        options.accountUuid,
        restoredMediaFileName(asset.sha256),
        (push) => options.archive.readPayload(archivePath, push),
      );
    } catch {
      stored = null;
    }

    const wrongSize =
      stored !== null &&
      asset.byte_count !== null &&
      stored.byteLength !== asset.byte_count;
    if (stored === null || wrongSize) {
      placements.set(asset.id, {
        assetId: asset.id,
        availability: "missing",
        reason: "Cyd could not restore this file from the archive.",
      });
      continue;
    }

    byDigest.set(asset.sha256, stored.uri);
    placements.set(asset.id, {
      assetId: asset.id,
      availability: "restored",
      localPath: stored.uri,
    });
    placed += 1;
    options.onPlaced(placed);
  }

  return placements;
}

/**
 * What the restored account knows about where it came from.
 *
 * The completeness the archive declared is kept rather than recomputed: a
 * restored account that is missing an asset has to keep saying so, and it must
 * not stop the rest of the account from being useful.
 */
async function writeRestoreConfig(
  database: RestoredAccountDatabase,
  snapshot: BlueskyInterchangeSnapshot,
): Promise<void> {
  const entries: [string, string][] = [
    // A restored Bluesky local account holds no Bluesky connection. Saying so
    // here means it opens straight into its Bluesky saved data instead of
    // reaching for an authorization this installation never had.
    [ACCOUNT_CONFIG_KEYS.authStatus, ACCOUNT_AUTH_STATUS.signedOut],
    [ACCOUNT_CONFIG_KEYS.restoredArchiveCompleteness, snapshot.archive.completeness],
    // The identifier the archive carried, which is what a remapping report
    // refers to once the restored account is listed under a different one.
    [ACCOUNT_CONFIG_KEYS.restoredArchiveUuid, snapshot.archive.account_uuid],
  ];

  for (const [key, value] of entries) {
    await database.run(
      `INSERT INTO config (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
      [key, value],
    );
  }
}

/**
 * What the restored account actually holds, counted the way browse counts it.
 *
 * Deliberately not a count of what the archive selected: a selection naming a
 * record the archive does not carry restores nothing, and reporting it anyway
 * would tell somebody they recovered likes they cannot open.
 * `unrestorable.selections` is where those go.
 */
function countRestored(
  restored: RestoredMobileAccount,
): RestoredCategoryCounts {
  const posts = restored.posts;
  return {
    posts: posts.filter(
      (post) => post.authorDid === restored.identity.did && post.isRepost === 0,
    ).length,
    reposts: posts.filter((post) => post.viewerReposted === 1).length,
    likes: posts.filter((post) => post.viewerLiked === 1).length,
    bookmarks: posts.filter((post) => post.viewerBookmarked === 1).length,
    chats: restored.conversations.length,
    messages: restored.messages.length,
    profiles: restored.profiles.length,
    follows: restored.follows.length,
  };
}

function summarizeAssets(
  placements: Map<string, RestoredAssetPlacement>,
  total: number,
): RestoredAssetSummary {
  let restored = 0;
  for (const placement of placements.values()) {
    if (placement.availability === "restored") {
      restored += 1;
    }
  }
  return { total, restored, missing: total - restored };
}

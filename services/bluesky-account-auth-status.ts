import type { AppBskyActorDefs } from "@atproto/api";

import { BlueskyAccountController } from "@/controllers/BlueskyAccountController";
import {
  ACCOUNT_AUTH_STATUS,
  ACCOUNT_CONFIG_KEYS,
  type AccountAuthStatusValue,
} from "@/controllers/config";
import type { AccountListItem } from "@/database/accounts";
import { emitAuthStatusChange } from "@/services/auth-events";
import { getBlueskyConnection } from "@/services/bluesky-connection-store";

export function normalizeHandle(
  handle: string | null | undefined,
): string | null {
  if (!handle) {
    return null;
  }
  const trimmed = handle.startsWith("@") ? handle.slice(1) : handle;
  return trimmed.toLowerCase();
}

function profileMatchesAccount(
  profile: AppBskyActorDefs.ProfileViewDetailed,
  account: AccountListItem,
): boolean {
  const profileDid = profile.did ?? null;
  const accountDid = account.did ?? null;
  const didMatches = Boolean(
    profileDid && accountDid && profileDid === accountDid,
  );

  const profileHandle = normalizeHandle(profile.handle);
  const accountHandle = normalizeHandle(account.handle);
  const handleMatches = Boolean(
    profileHandle && accountHandle && profileHandle === accountHandle,
  );

  return didMatches || handleMatches;
}

function isMissingSessionError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  if (err.name === "MissingBlueskySessionError") {
    return true;
  }
  const message = err.message?.toLowerCase() ?? "";
  return (
    message.includes("session was deleted") ||
    message.includes("no session found") ||
    message.includes("missing bluesky did") ||
    message.includes("account not found")
  );
}

/**
 * Check whether Cyd can still act on a Bluesky local account, and persist the
 * result.
 *
 * Pass `force` after anything that changes the account's Bluesky connection.
 * It both skips the stored-status shortcut and rebuilds the controller's agent
 * from the stored connection, so the check reflects the connection that exists
 * now rather than the one the controller was last built from.
 */
/**
 * Whether this device still holds a Bluesky connection for the account.
 *
 * When atproto concludes that a session is unusable it deletes the stored
 * connection, so an empty store after a failed check is the dependable signal
 * that the account is signed out. The error itself is not: the one that
 * surfaces from a revoked session says only that it expired, and atproto's
 * refresh failures carry whatever description the authorization server sent
 * back. A store that cannot be read counts as intact, so a failure to read it
 * never signs the account out on its own.
 */
async function hasStoredConnection(account: AccountListItem): Promise<boolean> {
  try {
    const connection = await getBlueskyConnection({
      accountUUID: account.uuid,
      legacyDid: account.did ?? undefined,
    });
    return connection !== null;
  } catch (err) {
    console.warn("Failed to read the stored Bluesky connection", err);
    return true;
  }
}

export async function verifyBlueskyAccountAuthStatus(
  controller: BlueskyAccountController,
  account: AccountListItem,
  options?: { force?: boolean },
): Promise<AccountAuthStatusValue> {
  const force = options?.force ?? false;
  console.log("[AuthStatus] verify -> start", account.id, account.handle);
  let storedStatus: AccountAuthStatusValue | null = null;
  try {
    const rawStatus = await controller.getConfig(
      ACCOUNT_CONFIG_KEYS.authStatus,
    );
    if (
      rawStatus === ACCOUNT_AUTH_STATUS.authenticated ||
      rawStatus === ACCOUNT_AUTH_STATUS.signedOut
    ) {
      storedStatus = rawStatus;
    }
    console.log("[AuthStatus] stored status", account.id, storedStatus);
  } catch (err) {
    console.warn("Failed to get Bluesky auth status", err);
  }

  let status: AccountAuthStatusValue =
    storedStatus ?? ACCOUNT_AUTH_STATUS.signedOut;

  // If we already know the session is signed out, skip agent init to avoid
  // surfacing expected "session deleted" errors during job startup.
  if (!force && status === ACCOUNT_AUTH_STATUS.signedOut) {
    return status;
  }

  try {
    // A forced check follows something that changed the stored connection, so
    // the agent is rebuilt even when one is already loaded: reusing an agent
    // built from a superseded Bluesky connection makes the current one look
    // expired, and the failed refresh deletes it.
    if (force || !controller.isAgentReady()) {
      console.log("[AuthStatus] initAgent required", account.id, { force });
      await controller.initAgent();
    }
    const profile = await controller.getProfile();
    console.log("[AuthStatus] profile retrieved", account.id, Boolean(profile));
    if (profile && profileMatchesAccount(profile, account)) {
      status = ACCOUNT_AUTH_STATUS.authenticated;
    } else {
      status = ACCOUNT_AUTH_STATUS.signedOut;
    }
    console.log("[AuthStatus] profile match result", account.id, status);
  } catch (err) {
    console.warn("Unable to verify Bluesky auth status", err);
    if (isMissingSessionError(err) || !(await hasStoredConnection(account))) {
      status = ACCOUNT_AUTH_STATUS.signedOut;
    } else {
      // The connection is still there, so the check failed for some other
      // reason — being offline, most likely. Leave the status alone.
      status = storedStatus ?? ACCOUNT_AUTH_STATUS.signedOut;
    }
  }

  try {
    await controller.setConfig(ACCOUNT_CONFIG_KEYS.authStatus, status);
    console.log("[AuthStatus] status persisted", account.id, status);
    emitAuthStatusChange({ accountId: account.id, status });
  } catch (err) {
    console.warn("Failed to persist Bluesky auth status", err);
  }

  console.log("[AuthStatus] verify -> end", account.id, status);
  return status;
}

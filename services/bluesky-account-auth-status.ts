import type { AppBskyActorDefs } from "@atproto/api";

import { BlueskyAccountController } from "@/controllers/BlueskyAccountController";
import {
  ACCOUNT_AUTH_STATUS,
  ACCOUNT_CONFIG_KEYS,
  type AccountAuthStatusValue,
} from "@/controllers/config";
import type { AccountListItem } from "@/database/accounts";
import { emitAuthStatusChange } from "@/services/auth-events";

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
    if (!controller.isAgentReady()) {
      console.log("[AuthStatus] initAgent required", account.id);
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
    if (isMissingSessionError(err)) {
      status = ACCOUNT_AUTH_STATUS.signedOut;
    } else {
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

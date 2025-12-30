import type { AppBskyActorDefs } from "@atproto/api";

import type { AccountAuthStatusValue } from "@/controllers";
import {
  ACCOUNT_AUTH_STATUS,
  ACCOUNT_CONFIG_KEYS,
  BlueskyAccountController,
} from "@/controllers";
import type { AccountListItem } from "@/database/accounts";

export function normalizeHandle(
  handle: string | null | undefined
): string | null {
  if (!handle) {
    return null;
  }
  const trimmed = handle.startsWith("@") ? handle.slice(1) : handle;
  return trimmed.toLowerCase();
}

function profileMatchesAccount(
  profile: AppBskyActorDefs.ProfileViewDetailed,
  account: AccountListItem
): boolean {
  const profileDid = profile.did ?? null;
  const accountDid = account.did ?? null;
  const didMatches = Boolean(
    profileDid && accountDid && profileDid === accountDid
  );

  const profileHandle = normalizeHandle(profile.handle);
  const accountHandle = normalizeHandle(account.handle);
  const handleMatches = Boolean(
    profileHandle && accountHandle && profileHandle === accountHandle
  );

  return didMatches || handleMatches;
}

export async function verifyBlueskyAccountAuthStatus(
  controller: BlueskyAccountController,
  account: AccountListItem
): Promise<AccountAuthStatusValue> {
  let status: AccountAuthStatusValue = ACCOUNT_AUTH_STATUS.signedOut;
  try {
    if (!(await controller.getConfig(ACCOUNT_CONFIG_KEYS.authStatus))) {
      return status;
    }
  } catch (err) {
    console.warn("Failed to get Bluesky auth status", err);
  }

  try {
    const profile = await controller.getProfile();
    if (profile && profileMatchesAccount(profile, account)) {
      status = ACCOUNT_AUTH_STATUS.authenticated;
    }
  } catch (err) {
    console.warn("Unable to verify Bluesky auth status", err);
    status = ACCOUNT_AUTH_STATUS.signedOut;
  }

  try {
    await controller.setConfig(ACCOUNT_CONFIG_KEYS.authStatus, status);
  } catch (err) {
    console.warn("Failed to persist Bluesky auth status", err);
  }

  return status;
}

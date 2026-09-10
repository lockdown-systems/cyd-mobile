import {
  ACCOUNT_AUTH_STATUS,
  resetBlueskyControllerAgent,
  withBlueskyController,
  type AccountAuthStatusValue,
} from "@/controllers";
import type { AccountListItem } from "@/database/accounts";
import { verifyBlueskyAccountAuthStatus } from "@/services/bluesky-account-auth-status";
import { revokeBlueskyAuthorization } from "@/services/bluesky-oauth";

/**
 * Give up this device's Bluesky connection for one Bluesky local account, and
 * report the auth status that follows. The Bluesky local account and its
 * Bluesky saved data are untouched.
 *
 * The cached controller outlives the disconnect, so the agent built from the
 * connection being revoked has to be dropped in the same breath. Leaving it in
 * place is what made a later reauthentication delete its own fresh connection:
 * the stale session 401s, and atproto cleans up the store entry for that DID,
 * which by then holds the new connection. revokeBlueskyAuthorization cannot do
 * this itself — it sits below the controllers, and reaching up would put a
 * cycle between the connection store and the controllers it serves.
 */
export async function disconnectBlueskyAccount(
  account: AccountListItem,
): Promise<AccountAuthStatusValue> {
  console.log("[BlueskyDisconnect] revoke -> start", account.id);
  await revokeBlueskyAuthorization(account.id);
  resetBlueskyControllerAgent(account.id);
  console.log(
    "[BlueskyDisconnect] revoke -> connection and agent dropped",
    account.id,
  );

  try {
    return await withBlueskyController(account.id, account.uuid, (controller) =>
      verifyBlueskyAccountAuthStatus(controller, account),
    );
  } catch (err) {
    // The connection is gone whether or not the status check completed, so
    // never leave the account looking connected.
    console.warn("[BlueskyDisconnect] status check failed", account.id, err);
    return ACCOUNT_AUTH_STATUS.signedOut;
  }
}

import { withBlueskyController } from "@/controllers";
import type { AccountListItem } from "@/database/accounts";
import { trackEvent } from "@/services/analytics";
import { verifyBlueskyAccountAuthStatus } from "@/services/bluesky-account-auth-status";
import { authenticateBlueskyAccount } from "@/services/bluesky-oauth";
import { PlausibleEvents } from "@/types/analytics";

/**
 * Establish a Bluesky connection and leave the account knowing it has one.
 *
 * Authorizing is only half of signing in. Whether Cyd can act on a Bluesky
 * local account is a value cached in that account's own database, and
 * `verifyBlueskyAccountAuthStatus` returns the cached "signed out" without
 * looking at the stored connection at all unless it is forced — which is
 * exactly what an account that has never been connected holds. So an account
 * that was just authorized still reads as signed out, and asks the person to
 * authorize again, until something rebuilds its agent from the connection that
 * now exists.
 *
 * That makes the forced check part of signing in rather than something each
 * caller remembers, which matters most for the callers furthest from the
 * account screen: a Bluesky local account restored from a Cyd Bluesky archive
 * has no cached status and no connection, and is signed in from the import
 * that created it.
 */
export async function connectBlueskyAccount(
  handle: string,
): Promise<AccountListItem> {
  const account = await authenticateBlueskyAccount(handle);
  trackEvent(PlausibleEvents.BLUESKY_USER_SIGNED_IN);

  try {
    await withBlueskyController(account.id, account.uuid, (controller) =>
      verifyBlueskyAccountAuthStatus(controller, account, { force: true }),
    );
  } catch (err) {
    // The connection is stored either way, so this is not a failed sign-in.
    // The account will read as signed out until some forced check succeeds —
    // opening it is not enough, since that check trusts the cached status —
    // but its "sign in" action runs one.
    console.warn(
      "[BlueskySignIn] could not persist auth status after authorizing",
      err,
    );
  }

  return account;
}

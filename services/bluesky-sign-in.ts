import {
  ACCOUNT_AUTH_STATUS,
  withBlueskyController,
  type AccountAuthStatusValue,
} from "@/controllers";
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
 *
 * Everywhere somebody signs in comes through here, because the steps that
 * follow authorizing are the ones easy to leave out and hard to notice
 * missing: an account that has to be authorized twice, or one that goes on
 * showing the name and avatar an archive carried long after Bluesky told Cyd
 * the real ones.
 */
export type BlueskySignIn = {
  account: AccountListItem;
  /** What the account now knows about itself, for a caller showing it. */
  status: AccountAuthStatusValue;
};

export async function connectBlueskyAccount(
  handle: string,
): Promise<BlueskySignIn> {
  const account = await authenticateBlueskyAccount(handle);
  trackEvent(PlausibleEvents.BLUESKY_USER_SIGNED_IN);

  let status: AccountAuthStatusValue = ACCOUNT_AUTH_STATUS.signedOut;
  try {
    status = await withBlueskyController(
      account.id,
      account.uuid,
      async (controller) => {
        const verified = await verifyBlueskyAccountAuthStatus(
          controller,
          account,
          { force: true },
        );
        if (verified === ACCOUNT_AUTH_STATUS.authenticated) {
          try {
            // Browse reads an author out of the account's own database, which
            // for a restored account holds what the Cyd Bluesky archive
            // carried. This is the first moment Cyd has anything newer to put
            // there — and failing to write it down is not a failed sign-in,
            // so it does not take the status with it.
            await controller.refreshOwnProfile();
          } catch (err) {
            console.warn("[BlueskySignIn] could not refresh the profile", err);
          }
        }
        return verified;
      },
    );
  } catch (err) {
    // The connection is stored either way, so this is not a failed sign-in.
    // The account will read as signed out until some forced check succeeds —
    // opening it is not enough, since that check trusts the cached status —
    // but signing in again runs one.
    console.warn(
      "[BlueskySignIn] could not finish signing in after authorizing",
      err,
    );
  }

  return { account, status };
}

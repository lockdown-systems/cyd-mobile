import {
  ACCOUNT_AUTH_STATUS,
  withBlueskyController,
  type AccountAuthStatusValue,
} from "@/controllers";
import type { AccountListItem } from "@/database/accounts";
import { verifyBlueskyAccountAuthStatus } from "@/services/bluesky-account-auth-status";
import { authenticateBlueskyAccount } from "@/services/bluesky-oauth";

/**
 * Establish a Bluesky connection and leave the account knowing it has one.
 *
 * The auth status is cached per-account, so a just-authorized account still
 * reads as signed out until a forced check rebuilds its agent — which is why
 * every sign-in path comes through here.
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
            // For a restored account this is the first moment Cyd has a profile
            // newer than the archive carried. Failing to write it down is not
            // a failed sign-in.
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

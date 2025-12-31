import { getDatabase } from "@/database";
import type { AccountListItem } from "@/database/accounts";
import { verifyBlueskyAccountAuthStatus } from "@/services/bluesky-account-auth-status";
import { authenticateBlueskyAccount } from "@/services/bluesky-oauth";

import type { BlueskyAccountController } from "../../BlueskyAccountController";
import { ACCOUNT_AUTH_STATUS, type AccountAuthStatusValue } from "../../config";
import type { BlueskyJobRecord, JobEmit } from "../job-types";

async function loadAccount(
  controller: BlueskyAccountController
): Promise<AccountListItem> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<
    AccountListItem & { bskyAccountID: number }
  >(
    `SELECT a.id, a.uuid, a.sortOrder, a.type, a.bskyAccountID, b.handle, b.displayName, b.avatarDataURI, b.did
       FROM account a
       INNER JOIN bsky_account b ON b.id = a.bskyAccountID
      WHERE a.id = ?
      LIMIT 1;`,
    [controller.getAccountId()]
  );

  if (!row) {
    throw new Error("Account not found for verification");
  }

  return {
    id: row.id,
    uuid: row.uuid,
    sortOrder: row.sortOrder,
    type: "bluesky",
    handle: row.handle,
    displayName: row.displayName,
    avatarDataURI: row.avatarDataURI ?? null,
    did: row.did ?? null,
  } satisfies AccountListItem;
}

async function ensureAuthorized(
  controller: BlueskyAccountController,
  emit: JobEmit
): Promise<AccountAuthStatusValue> {
  const account = await loadAccount(controller);
  const initialStatus = await verifyBlueskyAccountAuthStatus(
    controller,
    account,
    { force: true }
  );
  if (initialStatus === ACCOUNT_AUTH_STATUS.authenticated) {
    return initialStatus;
  }

  emit({
    progressMessage:
      "Reauthentication required — Opening Bluesky to refresh your session…",
  });

  await controller.waitForPause();

  try {
    await authenticateBlueskyAccount(account.handle);
  } catch (err) {
    const message =
      err instanceof Error && err.message
        ? err.message
        : "Reauthentication canceled";
    throw new Error(message);
  }

  await controller.waitForPause();

  const finalStatus = await verifyBlueskyAccountAuthStatus(
    controller,
    account,
    {
      force: true,
    }
  );
  if (finalStatus !== ACCOUNT_AUTH_STATUS.authenticated) {
    throw new Error("Unable to verify authorization after reauthentication");
  }
  return finalStatus;
}

export async function runVerifyAuthorizationJob(
  controller: BlueskyAccountController,
  job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm making sure I still have access to your Bluesky account",
    progressMessage: "Verifying Bluesky session…",
  });

  await controller.waitForPause();
  const status = await ensureAuthorized(controller, emit);
  if (status !== ACCOUNT_AUTH_STATUS.authenticated) {
    throw new Error("Authorization failed");
  }
  emit({ progressMessage: "Bluesky session verified" });
}

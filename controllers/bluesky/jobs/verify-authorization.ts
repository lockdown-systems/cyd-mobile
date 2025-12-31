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
  console.log(
    "[verify-auth] start ensureAuthorized",
    controller.getAccountId()
  );
  const account = await loadAccount(controller);
  console.log("[verify-auth] account loaded", {
    accountId: account.id,
    handle: account.handle,
    did: account.did,
  });
  const initialStatus = await verifyBlueskyAccountAuthStatus(
    controller,
    account,
    { force: true }
  );
  console.log("[verify-auth] initial status", {
    accountId: account.id,
    status: initialStatus,
  });
  if (initialStatus === ACCOUNT_AUTH_STATUS.authenticated) {
    console.log("[verify-auth] already authenticated");
    return initialStatus;
  }

  emit({
    progressMessage:
      "Reauthentication required — Opening Bluesky to refresh your session…",
  });

  console.log("[verify-auth] waiting before reauth");
  await controller.waitForPause();

  try {
    console.log("[verify-auth] triggering authenticateBlueskyAccount", {
      handle: account.handle,
    });
    await authenticateBlueskyAccount(account.handle);
    console.log("[verify-auth] authenticateBlueskyAccount returned");
  } catch (err) {
    console.warn("[verify-auth] reauth failed", err);
    const message =
      err instanceof Error && err.message
        ? err.message
        : "Reauthentication canceled";
    throw new Error(message);
  }

  console.log("[verify-auth] waiting after reauth");
  await controller.waitForPause();

  const finalStatus = await verifyBlueskyAccountAuthStatus(
    controller,
    account,
    {
      force: true,
    }
  );
  console.log("[verify-auth] final status", {
    accountId: account.id,
    status: finalStatus,
  });
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
  console.log("[verify-auth] job start", {
    jobId: job.id,
    accountId: controller.getAccountId(),
  });
  emit({
    speechText: "I'm making sure I still have access to your Bluesky account",
    progressMessage: "Verifying Bluesky session…",
  });

  await controller.waitForPause();
  const status = await ensureAuthorized(controller, emit);
  if (status !== ACCOUNT_AUTH_STATUS.authenticated) {
    console.warn("[verify-auth] status not authenticated", { status });
    throw new Error("Authorization failed");
  }
  emit({ progressMessage: "Bluesky session verified" });
  console.log("[verify-auth] job complete", {
    jobId: job.id,
    accountId: controller.getAccountId(),
  });
}

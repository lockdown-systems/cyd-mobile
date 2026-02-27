/**
 * Utility function to submit Bluesky progress to the Cyd API.
 *
 * This function retrieves database stats from a BlueskyAccountController
 * and sends them to the server for tracking progress.
 */

import { withBlueskyController } from "@/controllers";
import type { BlueskyDatabaseStats } from "@/controllers/bluesky/types";
import type CydAPIClient from "./cyd-api-client";
import type { PostBlueskyProgressAPIRequest } from "./cyd-api-client";

/**
 * Submits Bluesky progress to the server.
 *
 * @param apiClient - The CydAPIClient instance to use for the API call
 * @param accountId - The local account ID
 * @param accountUUID - The account UUID to identify this account on the server
 * @returns true if successful, false otherwise
 */
export async function submitBlueskyProgress(
  apiClient: CydAPIClient,
  accountId: number,
  accountUUID: string,
): Promise<boolean> {
  try {
    console.log("[submitBlueskyProgress] Starting for account", accountId);

    const stats: BlueskyDatabaseStats = await withBlueskyController(
      accountId,
      accountUUID,
      async (controller) => controller.getDatabaseStats(),
    );
    console.log("[submitBlueskyProgress] Got stats:", stats);

    // Map stats to the API request format
    const request: PostBlueskyProgressAPIRequest = {
      account_uuid: accountUUID,
      total_posts_saved: stats.postsCount,
      total_reposts_saved: stats.repostsCount,
      total_likes_saved: stats.likesCount,
      total_bookmarks_saved: stats.bookmarksCount,
      total_follows_saved: stats.followsCount,
      total_conversations_saved: stats.conversationsCount,
      total_messages_saved: stats.messagesCount,
      total_posts_deleted: stats.deletedPostsCount,
      total_reposts_deleted: stats.deletedRepostsCount,
      total_likes_deleted: stats.deletedLikesCount,
      total_bookmarks_deleted: stats.deletedBookmarksCount,
      total_messages_deleted: stats.deletedMessagesCount,
      total_accounts_unfollowed: stats.unfollowedCount,
    };

    // Submit to the API
    const result = await apiClient.postBlueskyProgress(request);

    if (typeof result === "boolean" && result) {
      console.log("[submitBlueskyProgress] Success for account", accountId);
      return true;
    } else {
      console.warn(
        "[submitBlueskyProgress] Failed for account",
        accountId,
        result,
      );
      return false;
    }
  } catch (error) {
    console.error("[submitBlueskyProgress] Error:", error);
    return false;
  }
}

/**
 * Submits Bluesky progress for all accounts.
 * This is useful after a user signs in, to ensure any previously
 * unauthenticated progress submissions are now associated with their account.
 *
 * @param apiClient - The CydAPIClient instance to use for the API calls
 * @returns The number of accounts successfully submitted
 */
export async function submitBlueskyProgressForAllAccounts(
  apiClient: CydAPIClient,
): Promise<number> {
  try {
    console.log("[submitBlueskyProgressForAllAccounts] Starting");

    // Import listAccounts dynamically to avoid circular dependencies
    const { listAccounts } = await import("@/database/accounts");
    const accounts = await listAccounts();

    console.log(
      "[submitBlueskyProgressForAllAccounts] Found",
      accounts.length,
      "accounts",
    );

    let successCount = 0;
    for (const account of accounts) {
      const success = await submitBlueskyProgress(
        apiClient,
        account.id,
        account.uuid,
      );
      if (success) {
        successCount++;
      }
    }

    console.log(
      "[submitBlueskyProgressForAllAccounts] Completed:",
      successCount,
      "of",
      accounts.length,
      "succeeded",
    );
    return successCount;
  } catch (error) {
    console.error("[submitBlueskyProgressForAllAccounts] Error:", error);
    return 0;
  }
}

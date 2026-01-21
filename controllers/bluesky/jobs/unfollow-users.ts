import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit, ProfileData } from "../job-types";

export async function runUnfollowUsersJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit,
): Promise<void> {
  emit({
    speechText: "I'm unfollowing users for you",
    progressMessage: "Fetching list of accounts you follow…",
    unknownTotal: true,
    progressPercent: 0,
  });

  if (!controller.isAgentReady()) {
    await controller.initAgent();
  }

  // Fetch follows from the API since we don't save them locally
  // This shows an indeterminate progress while fetching
  let fetchedCount = 0;
  const followsToUnfollow = await controller.fetchFollowsFromApi((count) => {
    fetchedCount = count;
    emit({
      progressMessage: `Found ${count.toLocaleString()} accounts to unfollow…`,
      unknownTotal: true,
      progressPercent: 0,
    });
  });

  const total = followsToUnfollow.length;

  if (total === 0) {
    emit({
      progressMessage: "No users to unfollow",
      progressPercent: 1,
      unknownTotal: false,
      progress: { currentItemIndex: 0, totalItems: 0 },
    });
    return;
  }

  // Now we know the total, show a real progress bar
  emit({
    progressMessage: `Ready to unfollow ${total.toLocaleString()} accounts`,
    progressPercent: 0,
    unknownTotal: false,
    progress: { currentItemIndex: 0, totalItems: total },
  });

  let unfollowed = 0;
  let errors = 0;

  for (const follow of followsToUnfollow) {
    await controller.waitForPause();

    // Build preview data for display
    const previewData: ProfileData = {
      did: follow.subjectDid,
      handle: follow.handle,
      displayName: follow.displayName,
    };

    emit({
      progressMessage: `Unfollowing ${follow.handle} (${(unfollowed + 1).toLocaleString()} of ${total.toLocaleString()})…`,
      progressPercent: unfollowed / total,
      unknownTotal: false,
      previewData: { type: "profile", data: previewData },
      progress: { currentItemIndex: unfollowed, totalItems: total },
    });

    try {
      await controller.unfollowUser(follow.uri, {
        subjectDid: follow.subjectDid,
        handle: follow.handle,
        displayName: follow.displayName,
      });
      unfollowed++;
    } catch (err) {
      console.warn(
        "[UnfollowUsersJob] Failed to unfollow:",
        follow.handle,
        err,
      );
      errors++;
      // Continue with next user despite error
    }
  }

  emit({
    progressMessage: `Unfollowed ${unfollowed.toLocaleString()} users${errors > 0 ? ` (${errors.toLocaleString()} failed)` : ""}`,
    progressPercent: 1,
    unknownTotal: false,
    progress: { currentItemIndex: unfollowed, totalItems: total },
  });
}

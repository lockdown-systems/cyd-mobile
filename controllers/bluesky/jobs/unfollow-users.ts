import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit, ProfileData } from "../job-types";

export async function runUnfollowUsersJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm unfollowing users for you",
    progressMessage: "Preparing to unfollow users…",
    unknownTotal: false,
    progressPercent: 0,
  });

  if (!controller.isAgentReady()) {
    await controller.initAgent();
  }

  // Get the delete settings
  const settings = controller.getDeleteSettings();
  if (!settings) {
    throw new Error("Delete settings not found");
  }

  // Get follows to unfollow
  const followsToUnfollow = controller.getFollowsToUnfollow(settings);
  const total = followsToUnfollow.length;

  if (total === 0) {
    emit({
      progressMessage: "No users to unfollow",
      progressPercent: 1,
      unknownTotal: false,
    });
    return;
  }

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
      progressMessage: `Unfollowing ${follow.handle} (${unfollowed + 1} of ${total})…`,
      progressPercent: unfollowed / total,
      unknownTotal: false,
      previewData: { type: "profile", data: previewData },
      progress: { currentItemIndex: unfollowed, totalItems: total },
    });

    try {
      await controller.unfollowUser(follow.uri);
      unfollowed++;
    } catch (err) {
      console.warn(
        "[UnfollowUsersJob] Failed to unfollow:",
        follow.handle,
        err
      );
      errors++;
      // Continue with next user despite error
    }
  }

  emit({
    progressMessage: `Unfollowed ${unfollowed} users${errors > 0 ? ` (${errors} failed)` : ""}`,
    progressPercent: 1,
    unknownTotal: false,
    progress: { currentItemIndex: unfollowed, totalItems: total },
  });
}

import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit, PostPreviewData } from "../job-types";

export async function runDeleteRepostsJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm deleting your reposts",
    progressMessage: "Preparing to delete reposts…",
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

  // Get reposts to delete
  const repostsToDelete = controller.getRepostsToDelete(settings);
  const total = repostsToDelete.length;

  if (total === 0) {
    emit({
      progressMessage: "No reposts to delete",
      progressPercent: 1,
      unknownTotal: false,
    });
    return;
  }

  let deleted = 0;
  let errors = 0;

  for (const repost of repostsToDelete) {
    await controller.waitForPause();

    // Build preview data for display (showing the reposted post info)
    const previewData: PostPreviewData = {
      uri: repost.originalPostUri,
      cid: repost.repostCid,
      text: `Repost of ${repost.originalPostUri}`,
      createdAt: repost.createdAt,
      savedAt: repost.createdAt,
      author: {
        did: "",
        handle: "repost",
      },
      isRepost: true,
    };

    emit({
      progressMessage: `Deleting repost ${deleted + 1} of ${total}…`,
      progressPercent: deleted / total,
      unknownTotal: false,
      previewData: { type: "post", data: previewData },
      progress: { currentItemIndex: deleted, totalItems: total },
    });

    try {
      await controller.deleteRepost(repost.repostUri);
      deleted++;
    } catch (err) {
      console.warn(
        "[DeleteRepostsJob] Failed to delete repost:",
        repost.repostUri,
        err
      );
      errors++;
      // Continue with next repost despite error
    }
  }

  emit({
    progressMessage: `Deleted ${deleted} reposts${errors > 0 ? ` (${errors} failed)` : ""}`,
    progressPercent: 1,
    unknownTotal: false,
    progress: { currentItemIndex: deleted, totalItems: total },
  });
}

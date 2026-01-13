import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit, PostPreviewData } from "../job-types";

export async function runDeleteLikesJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm deleting your likes",
    progressMessage: "Preparing to delete likes…",
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

  // Get likes to delete
  const likesToDelete = controller.getLikesToDelete(settings);
  const total = likesToDelete.length;

  if (total === 0) {
    emit({
      progressMessage: "No likes to delete",
      progressPercent: 1,
      unknownTotal: false,
      progress: { currentItemIndex: 0, totalItems: 0 },
    });
    return;
  }

  let deleted = 0;
  let errors = 0;

  for (const like of likesToDelete) {
    await controller.waitForPause();

    // Build preview data for display (showing the liked post info)
    const previewData: PostPreviewData = {
      uri: like.uri,
      cid: "",
      text: like.text,
      createdAt: like.createdAt,
      savedAt: like.createdAt,
      author: {
        did: "",
        handle: like.authorHandle,
      },
    };

    emit({
      progressMessage: `Deleting like ${deleted + 1} of ${total}…`,
      progressPercent: deleted / total,
      unknownTotal: false,
      previewData: { type: "post", data: previewData },
      progress: { currentItemIndex: deleted, totalItems: total },
    });

    // Skip if we don't have the like URI (shouldn't happen after re-indexing)
    if (!like.likeUri) {
      console.warn("[DeleteLikesJob] No likeUri for post:", like.uri);
      errors++;
      continue;
    }

    try {
      await controller.deleteLike(like.likeUri, like.uri);
      deleted++;
    } catch (err) {
      console.warn(
        "[DeleteLikesJob] Failed to delete like:",
        like.likeUri,
        err
      );
      errors++;
      // Continue with next like despite error
    }
  }

  emit({
    progressMessage: `Deleted ${deleted} likes${errors > 0 ? ` (${errors} failed)` : ""}`,
    progressPercent: 1,
    unknownTotal: false,
    progress: { currentItemIndex: deleted, totalItems: total },
  });
}

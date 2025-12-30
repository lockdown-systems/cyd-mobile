import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit } from "../job-types";
import type { BlueskyProgress } from "../types";

function formatProgress(likesSaved: number, likesTotal: number | null): string {
  if (likesTotal === null || likesTotal === 0) {
    return `Saved ${likesSaved} likes`;
  }
  return `Saved ${likesSaved}/${likesTotal} likes`;
}

export async function runSaveLikesJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm saving all of your likes",
    progressText: "Fetching likes…",
  });

  controller.setProgressCallback((progress: BlueskyProgress) => {
    const fraction =
      progress.likesTotal && progress.likesTotal > 0
        ? Math.max(0, Math.min(1, progress.likesSaved / progress.likesTotal))
        : null;
    emit({
      progressText: formatProgress(progress.likesSaved, progress.likesTotal),
      progressPercent: fraction ?? undefined,
      detailText: progress.currentAction || undefined,
      previewPost: progress.previewPost,
    });
  });

  if (!controller.isAgentReady()) {
    await controller.initAgent();
  }

  await controller.waitForPause();
  await controller.indexLikes();
  await controller.waitForPause();

  emit({ progressText: "Saved likes", progressPercent: 1 });
}

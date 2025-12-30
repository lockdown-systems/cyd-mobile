import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit } from "../job-types";
import type { BlueskyProgress } from "../types";

function formatProgress(postsSaved: number, postsTotal: number | null): string {
  if (postsTotal === null || postsTotal === 0) {
    return `Saved ${postsSaved} posts`;
  }
  return `Saved ${postsSaved}/${postsTotal} posts`;
}

export async function runSavePostsJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm saving all of your posts",
    progressText: "Fetching posts…",
  });

  // Forward indexer progress to the job emitter so AutomationModal can display it.
  controller.setProgressCallback((progress: BlueskyProgress) => {
    const fraction =
      progress.postsTotal && progress.postsTotal > 0
        ? Math.max(0, Math.min(1, progress.postsSaved / progress.postsTotal))
        : null;
    emit({
      progressText: formatProgress(progress.postsSaved, progress.postsTotal),
      progressPercent: fraction ?? undefined,
      detailText: progress.currentAction || undefined,
      previewPost: progress.previewPost,
    });
  });

  if (!controller.isAgentReady()) {
    await controller.initAgent();
  }

  await controller.waitForPause();
  await controller.indexPosts();

  controller.pause();
  await controller.waitForPause();

  emit({ progressText: "Saved posts", progressPercent: 1 });
}

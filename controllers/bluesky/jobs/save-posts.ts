import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit } from "../job-types";
import type { BlueskyProgress, JobProgressSegment } from "../types";

function formatProgress(segment: JobProgressSegment): string {
  if (segment.unknownTotal || segment.total === null) {
    return `Saved ${segment.current.toLocaleString()} posts`;
  }
  return `Saved ${segment.current.toLocaleString()}/${segment.total.toLocaleString()} posts`;
}

export async function runSavePostsJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm saving all of your posts",
    progressMessage: "Fetching posts…",
    unknownTotal: true,
  });

  // Forward indexer progress to the job emitter so AutomationModal can display it.
  controller.setProgressCallback((progress: BlueskyProgress) => {
    const segment = progress.postsProgress;
    const message = progress.currentAction || formatProgress(segment);
    emit({
      progressMessage: message,
      progressPercent: undefined, // No percent for unknown total
      unknownTotal: segment.unknownTotal,
      previewPost: progress.previewPost,
    });
  });

  if (!controller.isAgentReady()) {
    await controller.initAgent();
  }

  await controller.waitForPause();
  await controller.indexPosts();
  await controller.waitForPause();

  // Clear the progress callback to prevent interference with subsequent jobs
  controller.clearProgressCallback();

  emit({
    progressMessage: "Saved posts",
    progressPercent: 1,
    unknownTotal: false,
  });
}

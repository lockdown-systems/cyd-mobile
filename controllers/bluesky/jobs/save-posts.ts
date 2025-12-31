import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit } from "../job-types";
import type { BlueskyProgress, JobProgressSegment } from "../types";

function formatProgress(segment: JobProgressSegment): string {
  if (segment.unknownTotal || segment.total === null) {
    return `Saved ${segment.current} posts`;
  }
  return `Saved ${segment.current}/${segment.total} posts`;
}

export async function runSavePostsJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm saving all of your posts",
    progressText: "Fetching posts…",
    unknownTotal: true,
  });

  // Forward indexer progress to the job emitter so AutomationModal can display it.
  controller.setProgressCallback((progress: BlueskyProgress) => {
    const segment = progress.postsProgress;
    emit({
      progressText: formatProgress(segment),
      progressPercent: undefined, // No percent for unknown total
      unknownTotal: segment.unknownTotal,
      detailText: progress.currentAction || undefined,
      previewPost: progress.previewPost,
    });
  });

  if (!controller.isAgentReady()) {
    await controller.initAgent();
  }

  await controller.waitForPause();
  await controller.indexPosts();

  await controller.waitForPause();

  emit({
    progressText: "Saved posts",
    progressPercent: 1,
    unknownTotal: false,
  });
}

import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit } from "../job-types";
import type { BlueskyProgress, JobProgressSegment } from "../types";

function formatProgress(segment: JobProgressSegment): string {
  if (segment.unknownTotal || segment.total === null) {
    return `Saved ${segment.current} bookmarks`;
  }
  return `Saved ${segment.current}/${segment.total} bookmarks`;
}

export async function runSaveBookmarksJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm saving all of your bookmarks",
    progressText: "Fetching bookmarks…",
    unknownTotal: true,
  });

  controller.setProgressCallback((progress: BlueskyProgress) => {
    const segment = progress.bookmarksProgress;
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
  await controller.indexBookmarks();
  await controller.waitForPause();

  emit({
    progressText: "Saved bookmarks",
    progressPercent: 1,
    unknownTotal: false,
  });
}

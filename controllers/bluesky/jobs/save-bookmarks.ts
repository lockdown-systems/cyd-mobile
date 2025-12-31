import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit } from "../job-types";
import type { BlueskyProgress, JobProgressSegment } from "../types";

function formatProgress(segment: JobProgressSegment): string {
  if (segment.unknownTotal || segment.total === null) {
    return `Saved ${segment.current.toLocaleString()} bookmarks`;
  }
  return `Saved ${segment.current.toLocaleString()}/${segment.total.toLocaleString()} bookmarks`;
}

export async function runSaveBookmarksJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm saving all of your bookmarks",
    progressMessage: "Fetching bookmarks…",
    unknownTotal: true,
  });

  controller.setProgressCallback((progress: BlueskyProgress) => {
    const segment = progress.bookmarksProgress;
    const message = progress.currentAction || formatProgress(segment);
    emit({
      progressMessage: message,
      progressPercent: undefined,
      unknownTotal: segment.unknownTotal,
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
    progressMessage: "Saved bookmarks",
    progressPercent: 1,
    unknownTotal: false,
  });
}

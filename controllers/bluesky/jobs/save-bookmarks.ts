import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit } from "../job-types";
import type { BlueskyProgress } from "../types";

function formatProgress(
  bookmarksSaved: number,
  bookmarksTotal: number | null
): string {
  if (bookmarksTotal === null || bookmarksTotal === 0) {
    return `Saved ${bookmarksSaved} bookmarks`;
  }
  return `Saved ${bookmarksSaved}/${bookmarksTotal} bookmarks`;
}

export async function runSaveBookmarksJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm saving all of your bookmarks",
    progressText: "Fetching bookmarks…",
  });

  controller.setProgressCallback((progress: BlueskyProgress) => {
    const fraction =
      progress.bookmarksTotal && progress.bookmarksTotal > 0
        ? Math.max(
            0,
            Math.min(1, progress.bookmarksSaved / progress.bookmarksTotal)
          )
        : null;
    emit({
      progressText: formatProgress(
        progress.bookmarksSaved,
        progress.bookmarksTotal
      ),
      progressPercent: fraction ?? undefined,
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

  emit({ progressText: "Saved bookmarks", progressPercent: 1 });
}

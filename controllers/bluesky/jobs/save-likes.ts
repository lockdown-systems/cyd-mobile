import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit } from "../job-types";
import type { BlueskyProgress, JobProgressSegment } from "../types";

function formatProgress(segment: JobProgressSegment): string {
  if (segment.unknownTotal || segment.total === null) {
    return `Saved ${segment.current} likes`;
  }
  return `Saved ${segment.current}/${segment.total} likes`;
}

export async function runSaveLikesJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm saving all of your likes",
    progressText: "Fetching likes…",
    unknownTotal: true,
  });

  controller.setProgressCallback((progress: BlueskyProgress) => {
    const segment = progress.likesProgress;
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
  await controller.indexLikes();
  await controller.waitForPause();

  emit({
    progressText: "Saved likes",
    progressPercent: 1,
    unknownTotal: false,
  });
}

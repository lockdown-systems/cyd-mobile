import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit } from "../job-types";
import type { BlueskyProgress } from "../types";

export async function runSaveChatConvosJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm saving all of your chat conversations",
    progressMessage: "Fetching conversations…",
    unknownTotal: true,
  });

  // Forward indexer progress to the job emitter so AutomationModal can display it.
  controller.setProgressCallback((progress: BlueskyProgress) => {
    const message = progress.currentAction || "Saving conversations...";
    emit({
      progressMessage: message,
      progressPercent: undefined,
      unknownTotal: true,
    });
  });

  if (!controller.isAgentReady()) {
    await controller.initAgent();
  }

  await controller.waitForPause();
  await controller.indexChatConvos();

  // Clear the progress callback to prevent interference with subsequent jobs
  controller.clearProgressCallback();

  emit({
    progressMessage: "Saved chat conversations",
    progressPercent: 1,
    unknownTotal: false,
  });
}

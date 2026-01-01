import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit } from "../job-types";
import type { BlueskyProgress } from "../types";

export async function runSaveChatMessagesJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm saving all of your chat messages",
    progressMessage: "Fetching messages…",
    unknownTotal: true,
  });

  // Forward indexer progress to the job emitter so AutomationModal can display it.
  controller.setProgressCallback((progress: BlueskyProgress) => {
    const message = progress.currentAction || "Saving messages...";
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
  await controller.indexChatMessages();

  // Clear the progress callback to prevent interference with subsequent jobs
  controller.clearProgressCallback();

  emit({
    progressMessage: "Saved chat messages",
    progressPercent: 1,
    unknownTotal: false,
  });
}

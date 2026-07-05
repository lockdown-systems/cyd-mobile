import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit } from "../job-types";
import type { BlueskyProgress } from "../types";

export async function runSaveChatMessagesJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit,
): Promise<void> {
  let lastProgress: BlueskyProgress | null = null;

  emit({
    speechText: "I'm saving all of your chat messages",
    progressMessage: "Fetching messages…",
    unknownTotal: true,
  });

  // Forward indexer progress to the job emitter so AutomationModal can display it.
  controller.setProgressCallback((progress: BlueskyProgress) => {
    lastProgress = progress;
    const message = progress.currentAction || "Saving messages...";
    const currentConversationLabel: string | null =
      (
        progress as {
          currentConversationLabel?: string | null;
        }
      ).currentConversationLabel ?? null;
    emit({
      progressMessage: message,
      progressPercent: undefined,
      unknownTotal: true,
      currentConversationLabel,
      previewData: progress.previewData,
      progress,
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
    currentConversationLabel: null,
    previewData: null,
    progress: lastProgress,
  });
}

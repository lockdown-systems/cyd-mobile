import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type {
  BlueskyJobRecord,
  JobEmit,
  MessagePreviewData,
} from "../job-types";

export async function runDeleteMessagesJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm deleting your chat messages",
    progressMessage: "Preparing to delete messages…",
    unknownTotal: false,
    progressPercent: 0,
  });

  if (!controller.isAgentReady()) {
    await controller.initAgent();
  }

  // Get the delete settings
  const settings = controller.getDeleteSettings();
  if (!settings) {
    throw new Error("Delete settings not found");
  }

  // Get messages to delete
  const messagesToDelete = controller.getMessagesToDelete(settings);
  const total = messagesToDelete.length;

  if (total === 0) {
    emit({
      progressMessage: "No messages to delete",
      progressPercent: 1,
      unknownTotal: false,
    });
    return;
  }

  let deleted = 0;
  let errors = 0;

  for (const message of messagesToDelete) {
    await controller.waitForPause();

    // Build preview data for display
    const previewData: MessagePreviewData = {
      messageId: message.messageId,
      convoId: message.convoId,
      text: message.text,
      sentAt: message.sentAt,
      savedAt: message.sentAt,
      sender: {
        did: "",
        handle: "you",
      },
    };

    emit({
      progressMessage: `Deleting message ${deleted + 1} of ${total}…`,
      progressPercent: deleted / total,
      unknownTotal: false,
      previewData: { type: "message", data: previewData },
      progress: { currentItemIndex: deleted, totalItems: total },
    });

    try {
      await controller.deleteMessage(message.convoId, message.messageId);
      deleted++;
    } catch (err) {
      console.warn(
        "[DeleteMessagesJob] Failed to delete message:",
        message.messageId,
        err
      );
      errors++;
      // Continue with next message despite error
    }
  }

  emit({
    progressMessage: `Deleted ${deleted} messages${errors > 0 ? ` (${errors} failed)` : ""}`,
    progressPercent: 1,
    unknownTotal: false,
    progress: { currentItemIndex: deleted, totalItems: total },
  });
}

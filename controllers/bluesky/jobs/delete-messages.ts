import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type {
  BlueskyJobRecord,
  JobEmit,
  MessagePreviewData,
} from "../job-types";

export async function runDeleteMessagesJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit,
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
      progress: { currentItemIndex: 0, totalItems: 0 },
    });
    return;
  }

  let deleted = 0;
  let errors = 0;

  // Track unique conversation IDs for cleanup check
  const conversationIds = new Set<string>();

  // Get signed-in user info for display (includes avatar from local DB)
  const userProfile = controller.getUserProfileData();
  const userDid = userProfile?.did ?? "";
  const userHandle = userProfile?.handle ?? "you";
  const userDisplayName = userProfile?.displayName;
  const userAvatarUrl = userProfile?.avatarUrl;

  // Collect all member DIDs from all messages for batch profile lookup
  const allMemberDids = new Set<string>();
  for (const message of messagesToDelete) {
    try {
      const memberDids = JSON.parse(message.memberDids) as string[];
      memberDids.forEach((did) => allMemberDids.add(did));
    } catch {
      // ignore parse errors
    }
  }

  // Fetch all profiles at once
  const profilesByDid = controller.getProfilesByDids(Array.from(allMemberDids));

  for (const message of messagesToDelete) {
    await controller.waitForPause();

    // Track this conversation for later cleanup check
    conversationIds.add(message.convoId);

    // Find the recipient (the other person in the conversation, not the current user)
    let recipient: {
      did: string;
      handle: string;
      displayName?: string | null;
      avatarUrl?: string | null;
    } | null = null;
    try {
      const memberDids = JSON.parse(message.memberDids) as string[];
      const recipientDid = memberDids.find((did) => did !== userDid);
      if (recipientDid) {
        const profile = profilesByDid.get(recipientDid);
        recipient = profile ?? { did: recipientDid, handle: "unknown" };
      }
    } catch {
      // ignore parse errors
    }

    // Get the actual sender's profile (could be the current user or the recipient)
    let senderProfile: {
      did: string;
      handle: string;
      displayName?: string | null;
      avatarUrl?: string | null;
    };
    if (message.senderDid === userDid) {
      // Message was sent by the current user
      senderProfile = {
        did: userDid,
        handle: userHandle,
        displayName: userDisplayName,
        avatarUrl: userAvatarUrl,
      };
    } else {
      // Message was sent by someone else (the recipient)
      const profile = profilesByDid.get(message.senderDid);
      senderProfile = profile ?? { did: message.senderDid, handle: "unknown" };
    }

    // Build preview data for display
    const previewData: MessagePreviewData = {
      messageId: message.messageId,
      convoId: message.convoId,
      text: message.text,
      sentAt: message.sentAt,
      savedAt: message.sentAt,
      sender: senderProfile,
      recipient: recipient,
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
        err,
      );
      errors++;
      // Continue with next message despite error
    }
  }

  // Check for empty conversations and clean them up
  let conversationsLeft = 0;
  const conversationArray = Array.from(conversationIds);

  for (const convoId of conversationArray) {
    await controller.waitForPause();

    emit({
      progressMessage: `Checking conversation ${conversationsLeft + 1} of ${conversationArray.length} for cleanup…`,
      progressPercent: 1,
      unknownTotal: false,
    });

    try {
      const messageCount =
        await controller.getConversationMessageCount(convoId);

      if (messageCount === 0) {
        emit({
          progressMessage: `Leaving empty conversation ${conversationsLeft + 1} of ${conversationArray.length}…`,
          progressPercent: 1,
          unknownTotal: false,
        });

        await controller.leaveConversation(convoId);
        conversationsLeft++;
      }
    } catch (err) {
      console.warn(
        "[DeleteMessagesJob] Failed to check/leave conversation:",
        convoId,
        err,
      );
      // Continue with next conversation despite error
    }
  }

  const conversationMessage =
    conversationsLeft > 0
      ? `, left ${conversationsLeft} empty conversation${conversationsLeft > 1 ? "s" : ""}`
      : "";

  emit({
    progressMessage: `Deleted ${deleted} messages${errors > 0 ? ` (${errors} failed)` : ""}${conversationMessage}`,
    progressPercent: 1,
    unknownTotal: false,
    progress: { currentItemIndex: deleted, totalItems: total },
  });
}

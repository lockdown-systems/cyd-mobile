import { trackEvent } from "@/services/analytics";
import { PlausibleEvents } from "@/types/analytics";

import type { BlueskyAccountController } from "../BlueskyAccountController";
import type { BlueskyJobRecord, BlueskyJobType, JobEmit } from "./job-types";
import { runSaveBookmarksJob } from "./jobs/save-bookmarks";
import { runSaveChatConvosJob } from "./jobs/save-chat-convos";
import { runSaveChatMessagesJob } from "./jobs/save-chat-messages";
import { runSaveLikesJob } from "./jobs/save-likes";
import { runSavePostsJob } from "./jobs/save-posts";
import { runVerifyAuthorizationJob } from "./jobs/verify-authorization";

/**
 * Map of job types to their corresponding Plausible event names
 */
const JOB_TYPE_TO_EVENT: Record<
  BlueskyJobType,
  (typeof PlausibleEvents)[keyof typeof PlausibleEvents]
> = {
  verifyAuthorization: PlausibleEvents.BLUESKY_JOB_STARTED_VERIFY_AUTHORIZATION,
  savePosts: PlausibleEvents.BLUESKY_JOB_STARTED_SAVE_POSTS,
  saveLikes: PlausibleEvents.BLUESKY_JOB_STARTED_SAVE_LIKES,
  saveBookmarks: PlausibleEvents.BLUESKY_JOB_STARTED_SAVE_BOOKMARKS,
  saveChatConvos: PlausibleEvents.BLUESKY_JOB_STARTED_SAVE_CHAT_CONVOS,
  saveChatMessages: PlausibleEvents.BLUESKY_JOB_STARTED_SAVE_CHAT_MESSAGES,
};

export async function runJob(
  controller: BlueskyAccountController,
  job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  // Track the job start event
  const eventName = JOB_TYPE_TO_EVENT[job.jobType];
  if (eventName) {
    trackEvent(eventName);
  }

  const handlers: Partial<
    Record<BlueskyJobRecord["jobType"], () => Promise<void>>
  > = {
    verifyAuthorization: () => runVerifyAuthorizationJob(controller, job, emit),
    savePosts: () => runSavePostsJob(controller, job, emit),
    saveLikes: () => runSaveLikesJob(controller, job, emit),
    saveBookmarks: () => runSaveBookmarksJob(controller, job, emit),
    saveChatConvos: () => runSaveChatConvosJob(controller, job, emit),
    saveChatMessages: () => runSaveChatMessagesJob(controller, job, emit),
  };

  const handler = handlers[job.jobType];
  if (handler) {
    await handler();
    return;
  }

  throw new Error(`Unknown job type: ${String(job.jobType)}`);
}

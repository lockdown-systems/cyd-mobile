import type { BlueskyAccountController } from "../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit } from "./job-types";
import { runDeleteBookmarksJob } from "./jobs/delete-bookmarks";
import { runDeleteLikesJob } from "./jobs/delete-likes";
import { runDeleteMessagesJob } from "./jobs/delete-messages";
import { runDeletePostsJob } from "./jobs/delete-posts";
import { runDeleteRepostsJob } from "./jobs/delete-reposts";
import { runSaveBookmarksJob } from "./jobs/save-bookmarks";
import { runSaveChatConvosJob } from "./jobs/save-chat-convos";
import { runSaveChatMessagesJob } from "./jobs/save-chat-messages";
import { runSaveLikesJob } from "./jobs/save-likes";
import { runSavePostsJob } from "./jobs/save-posts";
import { runUnfollowUsersJob } from "./jobs/unfollow-users";
import { runVerifyAuthorizationJob } from "./jobs/verify-authorization";

export async function runJob(
  controller: BlueskyAccountController,
  job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  const handlers: Partial<
    Record<BlueskyJobRecord["jobType"], () => Promise<void>>
  > = {
    verifyAuthorization: () => runVerifyAuthorizationJob(controller, job, emit),
    savePosts: () => runSavePostsJob(controller, job, emit),
    saveLikes: () => runSaveLikesJob(controller, job, emit),
    saveBookmarks: () => runSaveBookmarksJob(controller, job, emit),
    saveChatConvos: () => runSaveChatConvosJob(controller, job, emit),
    saveChatMessages: () => runSaveChatMessagesJob(controller, job, emit),
    deletePosts: () => runDeletePostsJob(controller, job, emit),
    deleteReposts: () => runDeleteRepostsJob(controller, job, emit),
    deleteLikes: () => runDeleteLikesJob(controller, job, emit),
    deleteBookmarks: () => runDeleteBookmarksJob(controller, job, emit),
    deleteMessages: () => runDeleteMessagesJob(controller, job, emit),
    unfollowUsers: () => runUnfollowUsersJob(controller, job, emit),
  };

  const handler = handlers[job.jobType];
  if (handler) {
    await handler();
    return;
  }

  throw new Error(`Unknown job type: ${String(job.jobType)}`);
}

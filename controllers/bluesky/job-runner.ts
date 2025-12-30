import type { BlueskyAccountController } from "../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit } from "./job-types";
import { runSaveBookmarksJob } from "./jobs/save-bookmarks";
import { runSaveLikesJob } from "./jobs/save-likes";
import { runSavePostsJob } from "./jobs/save-posts";
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
  };

  const handler = handlers[job.jobType];
  if (handler) {
    await handler();
    return;
  }

  switch (job.jobType) {
    case "saveChats":
    case "saveFollowing": {
      // TODO: implement in later phases
      throw new Error(`${job.jobType} is not implemented yet`);
    }
    default: {
      throw new Error(`Unknown job type: ${String(job.jobType)}`);
    }
  }
}

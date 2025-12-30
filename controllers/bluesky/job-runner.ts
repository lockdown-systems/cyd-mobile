import type { BlueskyAccountController } from "../BlueskyAccountController";
import type { BlueskyJobRecord } from "./job-types";

export type JobEmit = (update: {
  speechText?: string;
  progressText?: string;
  detailText?: string;
}) => void;

export async function runJob(
  controller: BlueskyAccountController,
  job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  switch (job.jobType) {
    case "verifyAuthorization": {
      emit({
        speechText: "Checking your Bluesky connection",
        progressText: "Verifying session…",
      });
      controller.pause();
      await controller.waitForPause();
      await controller.initAgent();
      emit({ progressText: "Session verified" });
      return;
    }
    case "savePosts": {
      emit({
        speechText: "Saving your posts",
        progressText: "Fetching posts…",
      });
      await controller.waitForPause();
      if (!controller.isAgentReady()) {
        await controller.initAgent();
      }
      await controller.waitForPause();
      await controller.indexPosts();
      emit({ progressText: "Saved posts" });
      return;
    }
    case "saveLikes":
    case "saveBookmarks":
    case "saveChats":
    case "saveFollowing": {
      // TODO: implement in later phases
      throw new Error(`${job.jobType} is not implemented yet`);
    }
    default: {
      const exhaustiveCheck: never = job.jobType;
      throw new Error(`Unknown job type: ${exhaustiveCheck as string}`);
    }
  }
}

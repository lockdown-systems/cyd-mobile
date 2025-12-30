import type { BlueskyAccountController } from "../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit } from "../job-types";

export async function runSavePostsJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm saving all of your posts",
    progressText: "Fetching posts…",
  });
  controller.pause();
  await controller.waitForPause();
  if (!controller.isAgentReady()) {
    await controller.initAgent();
  }
  await controller.waitForPause();
  await controller.indexPosts();
  emit({ progressText: "Saved posts" });
}

import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit, PostPreviewData } from "../job-types";

export async function runDeletePostsJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm deleting your posts",
    progressMessage: "Preparing to delete posts…",
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

  // Get posts to delete with preview data
  const postsToDelete = controller.getPostsToDeleteWithPreview(settings);
  const total = postsToDelete.length;

  if (total === 0) {
    emit({
      progressMessage: "No posts to delete",
      progressPercent: 1,
      unknownTotal: false,
    });
    return;
  }

  let deleted = 0;
  let errors = 0;

  for (const post of postsToDelete) {
    await controller.waitForPause();

    // Build preview data for display
    const previewData: PostPreviewData = {
      uri: post.uri,
      cid: post.cid,
      text: post.text,
      createdAt: post.createdAt,
      savedAt: String(post.savedAt),
      author: {
        did: post.authorDid,
        handle: post.authorHandle ?? "unknown",
        displayName: post.authorDisplayName,
        avatarUrl: post.avatarUrl,
      },
      likeCount: post.likeCount,
      repostCount: post.repostCount,
      replyCount: post.replyCount,
      quoteCount: post.quoteCount,
      isReply: post.isReply,
    };

    emit({
      progressMessage: `Deleting post ${deleted + 1} of ${total}…`,
      progressPercent: deleted / total,
      unknownTotal: false,
      previewData: { type: "post", data: previewData },
      progress: { currentItemIndex: deleted, totalItems: total },
    });

    try {
      await controller.deletePost(post.uri);
      deleted++;
    } catch (err) {
      console.warn("[DeletePostsJob] Failed to delete post:", post.uri, err);
      errors++;
      // Continue with next post despite error
    }
  }

  emit({
    progressMessage: `Deleted ${deleted} posts${errors > 0 ? ` (${errors} failed)` : ""}`,
    progressPercent: 1,
    unknownTotal: false,
    progress: { currentItemIndex: deleted, totalItems: total },
  });
}

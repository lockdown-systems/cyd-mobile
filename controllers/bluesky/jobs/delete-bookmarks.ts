import type { BlueskyAccountController } from "../../BlueskyAccountController";
import type { BlueskyJobRecord, JobEmit, PostPreviewData } from "../job-types";

export async function runDeleteBookmarksJob(
  controller: BlueskyAccountController,
  _job: BlueskyJobRecord,
  emit: JobEmit
): Promise<void> {
  emit({
    speechText: "I'm deleting your bookmarks",
    progressMessage: "Preparing to delete bookmarks…",
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

  // Get bookmarks to delete
  const bookmarksToDelete = controller.getBookmarksToDelete(settings);
  const total = bookmarksToDelete.length;

  if (total === 0) {
    emit({
      progressMessage: "No bookmarks to delete",
      progressPercent: 1,
      unknownTotal: false,
    });
    return;
  }

  let deleted = 0;
  let errors = 0;

  for (const bookmark of bookmarksToDelete) {
    await controller.waitForPause();

    // Build preview data for display (showing the bookmarked post info)
    const previewData: PostPreviewData = {
      uri: bookmark.subjectUri,
      cid: "",
      text: bookmark.postText ?? "Bookmarked post",
      createdAt: "",
      savedAt: "",
      author: {
        did: "",
        handle: "bookmarked",
      },
    };

    emit({
      progressMessage: `Deleting bookmark ${deleted + 1} of ${total}…`,
      progressPercent: deleted / total,
      unknownTotal: false,
      previewData: { type: "post", data: previewData },
      progress: { currentItemIndex: deleted, totalItems: total },
    });

    try {
      await controller.deleteBookmark(bookmark.id);
      deleted++;
    } catch (err) {
      console.warn(
        "[DeleteBookmarksJob] Failed to delete bookmark:",
        bookmark.id,
        err
      );
      errors++;
      // Continue with next bookmark despite error
    }
  }

  emit({
    progressMessage: `Deleted ${deleted} bookmarks${errors > 0 ? ` (${errors} failed)` : ""}`,
    progressPercent: 1,
    unknownTotal: false,
    progress: { currentItemIndex: deleted, totalItems: total },
  });
}

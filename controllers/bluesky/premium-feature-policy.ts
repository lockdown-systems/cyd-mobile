import type { SaveAndDeleteJobOptions } from "@/controllers/bluesky/job-types";
import type { AccountDeleteSettings } from "@/database/delete-settings";

export function deleteSettingsRequirePremium(
  settings: AccountDeleteSettings,
): boolean {
  return Boolean(
    settings.deletePosts ||
    settings.deleteReposts ||
    settings.deleteLikes ||
    settings.deleteBookmarks ||
    settings.deleteChats ||
    settings.deleteUnfollowEveryone
  );
}

export function saveAndDeleteOptionsRequirePremium(
  options: SaveAndDeleteJobOptions,
): boolean {
  return deleteSettingsRequirePremium(options.deleteOptions.settings);
}

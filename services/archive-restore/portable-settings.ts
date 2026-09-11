import type { InterchangePortableSetting } from "./interchange-reader";
import type { RestoredAccountSettings } from "./ports";

/**
 * Turning an archive's portable settings into a new account's defaults.
 *
 * This is the mirror of `services/archive-export/portable-settings.ts`, and it
 * carries the same boundary: save and delete *defaults* cross, schedules never
 * do. A portable setting is what the person chose to back up and what they
 * chose to delete, not authority to run deletion on this device (ADR 0015).
 *
 * They apply only to a Bluesky local account being created. An account that
 * already exists keeps its own settings, which is why nothing here is reachable
 * from the merge path (#97).
 */

const SETTING_COLUMNS: Record<string, string> = {
  save_posts: "settingSavePosts",
  save_likes: "settingSaveLikes",
  save_bookmarks: "settingSaveBookmarks",
  save_chats: "settingSaveChats",
  delete_posts: "settingDeletePosts",
  delete_reposts: "settingDeleteReposts",
  delete_likes: "settingDeleteLikes",
  delete_bookmarks: "settingDeleteBookmarks",
  delete_chats: "settingDeleteChats",
  // Mobile's unfollow-everyone switch is the delete-follows default.
  delete_follows: "settingDeleteUnfollowEveryone",
  // `save_reposts` has no Mobile column: reposts are saved with posts. Leaving
  // it out means Mobile keeps its own behaviour rather than inventing a switch.
};

export function accountSettingsFromPortableSettings(
  rows: InterchangePortableSetting[],
): RestoredAccountSettings {
  const settings: RestoredAccountSettings = {};

  for (const row of rows) {
    const column = SETTING_COLUMNS[row.key];
    if (!column) {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(row.value_json);
    } catch {
      continue;
    }
    if (typeof value !== "boolean") {
      continue;
    }
    settings[column] = value ? 1 : 0;
  }

  return settings;
}

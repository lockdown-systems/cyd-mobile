import type { PortableSettings } from "./interchange";

/**
 * Which Bluesky account settings are portable, and which stay on the device.
 *
 * A Cyd Bluesky archive carries save and delete *defaults* — what the person
 * chose to back up and what they chose to delete — because those make a
 * restored account useful immediately. It carries no schedule, because a
 * portable setting is a default and never authority to run deletion somewhere
 * else (ADR 0015, and the contract's privacy boundary).
 *
 * Mobile has no separate "save reposts" switch: reposts come with posts. The
 * key is left out rather than guessed at, so an importer sees "Mobile did not
 * say" instead of a preference nobody set.
 */

export type BlueskyAccountSettingsRow = {
  settingSavePosts?: number | null;
  settingSaveLikes?: number | null;
  settingSaveBookmarks?: number | null;
  settingSaveChats?: number | null;
  settingDeletePosts?: number | null;
  settingDeleteReposts?: number | null;
  settingDeleteLikes?: number | null;
  settingDeleteBookmarks?: number | null;
  settingDeleteChats?: number | null;
  settingDeleteUnfollowEveryone?: number | null;
};

const PORTABLE_COLUMNS = {
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
} as const satisfies Partial<Record<keyof PortableSettings, string>>;

export function portableSettingsFromAccountRow(
  row: BlueskyAccountSettingsRow | null | undefined,
): PortableSettings {
  if (!row) {
    return {};
  }

  const settings: PortableSettings = {};
  for (const [key, column] of Object.entries(PORTABLE_COLUMNS)) {
    const value = row[column as keyof BlueskyAccountSettingsRow];
    if (value !== undefined && value !== null) {
      settings[key as keyof PortableSettings] = value !== 0;
    }
  }
  return settings;
}

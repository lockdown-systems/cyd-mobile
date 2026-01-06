import { getDatabase } from "./index";

export type AccountDeleteSettings = {
  deletePosts: boolean;
  deletePostsDaysOldEnabled: boolean;
  deletePostsDaysOld: number;
  deletePostsLikesThresholdEnabled: boolean;
  deletePostsLikesThreshold: number;
  deletePostsRepostsThresholdEnabled: boolean;
  deletePostsRepostsThreshold: number;
  deletePostsPreserveThreads: boolean;
  deleteReposts: boolean;
  deleteRepostsDaysOldEnabled: boolean;
  deleteRepostsDaysOld: number;
  deleteLikes: boolean;
  deleteLikesDaysOldEnabled: boolean;
  deleteLikesDaysOld: number;
  deleteBookmarks: boolean;
  deleteChats: boolean;
  deleteChatsDaysOldEnabled: boolean;
  deleteChatsDaysOld: number;
  deleteUnfollowEveryone: boolean;
};

const DEFAULT_DELETE_SETTINGS: AccountDeleteSettings = {
  deletePosts: false,
  deletePostsDaysOldEnabled: false,
  deletePostsDaysOld: 0,
  deletePostsLikesThresholdEnabled: false,
  deletePostsLikesThreshold: 0,
  deletePostsRepostsThresholdEnabled: false,
  deletePostsRepostsThreshold: 0,
  deletePostsPreserveThreads: false,
  deleteReposts: false,
  deleteRepostsDaysOldEnabled: false,
  deleteRepostsDaysOld: 0,
  deleteLikes: false,
  deleteLikesDaysOldEnabled: false,
  deleteLikesDaysOld: 0,
  deleteBookmarks: false,
  deleteChats: false,
  deleteChatsDaysOldEnabled: false,
  deleteChatsDaysOld: 0,
  deleteUnfollowEveryone: false,
};

export type DeleteSettingsRow = {
  settingDeletePosts: number | null;
  settingDeletePostsDaysOldEnabled: number | null;
  settingDeletePostsDaysOld: number | null;
  settingDeletePostsLikesThresholdEnabled: number | null;
  settingDeletePostsLikesThreshold: number | null;
  settingDeletePostsRepostsThresholdEnabled: number | null;
  settingDeletePostsRepostsThreshold: number | null;
  settingDeletePostsPreserveThreads: number | null;
  settingDeleteReposts: number | null;
  settingDeleteRepostsDaysOldEnabled: number | null;
  settingDeleteRepostsDaysOld: number | null;
  settingDeleteLikes: number | null;
  settingDeleteLikesDaysOldEnabled: number | null;
  settingDeleteLikesDaysOld: number | null;
  settingDeleteBookmarks: number | null;
  settingDeleteChats: number | null;
  settingDeleteChatsDaysOldEnabled: number | null;
  settingDeleteChatsDaysOld: number | null;
  settingDeleteUnfollowEveryone: number | null;
};

function mapRowToSettings(
  row: DeleteSettingsRow | null
): AccountDeleteSettings {
  if (!row) {
    return { ...DEFAULT_DELETE_SETTINGS };
  }

  return {
    deletePosts: Boolean(row.settingDeletePosts),
    deletePostsDaysOldEnabled: Boolean(row.settingDeletePostsDaysOldEnabled),
    deletePostsDaysOld: row.settingDeletePostsDaysOld ?? 0,
    deletePostsLikesThresholdEnabled: Boolean(
      row.settingDeletePostsLikesThresholdEnabled
    ),
    deletePostsLikesThreshold: row.settingDeletePostsLikesThreshold ?? 0,
    deletePostsRepostsThresholdEnabled: Boolean(
      row.settingDeletePostsRepostsThresholdEnabled
    ),
    deletePostsRepostsThreshold: row.settingDeletePostsRepostsThreshold ?? 0,
    deletePostsPreserveThreads: Boolean(row.settingDeletePostsPreserveThreads),
    deleteReposts: Boolean(row.settingDeleteReposts),
    deleteRepostsDaysOldEnabled: Boolean(
      row.settingDeleteRepostsDaysOldEnabled
    ),
    deleteRepostsDaysOld: row.settingDeleteRepostsDaysOld ?? 0,
    deleteLikes: Boolean(row.settingDeleteLikes),
    deleteLikesDaysOldEnabled: Boolean(row.settingDeleteLikesDaysOldEnabled),
    deleteLikesDaysOld: row.settingDeleteLikesDaysOld ?? 0,
    deleteBookmarks: Boolean(row.settingDeleteBookmarks),
    deleteChats: Boolean(row.settingDeleteChats),
    deleteChatsDaysOldEnabled: Boolean(row.settingDeleteChatsDaysOldEnabled),
    deleteChatsDaysOld: row.settingDeleteChatsDaysOld ?? 0,
    deleteUnfollowEveryone: Boolean(row.settingDeleteUnfollowEveryone),
  };
}

export async function getAccountDeleteSettings(
  accountId: number
): Promise<AccountDeleteSettings> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<DeleteSettingsRow>(
    `SELECT
       b.settingDeletePosts,
       b.settingDeletePostsDaysOldEnabled,
       b.settingDeletePostsDaysOld,
       b.settingDeletePostsLikesThresholdEnabled,
       b.settingDeletePostsLikesThreshold,
       b.settingDeletePostsRepostsThresholdEnabled,
       b.settingDeletePostsRepostsThreshold,
       b.settingDeletePostsPreserveThreads,
       b.settingDeleteReposts,
       b.settingDeleteRepostsDaysOldEnabled,
       b.settingDeleteRepostsDaysOld,
       b.settingDeleteLikes,
       b.settingDeleteLikesDaysOldEnabled,
       b.settingDeleteLikesDaysOld,
       b.settingDeleteBookmarks,
       b.settingDeleteChats,
       b.settingDeleteChatsDaysOldEnabled,
       b.settingDeleteChatsDaysOld,
       b.settingDeleteUnfollowEveryone
     FROM bsky_account b
     INNER JOIN account a ON a.bskyAccountID = b.id
     WHERE a.id = ?
     LIMIT 1;`,
    [accountId]
  );

  if (!row) {
    throw new Error("Unable to load delete settings for this account");
  }

  return mapRowToSettings(row);
}

export async function updateAccountDeleteSettings(
  accountId: number,
  settings: AccountDeleteSettings
): Promise<void> {
  const db = await getDatabase();
  const accountRow = await db.getFirstAsync<{ bskyAccountID: number }>(
    `SELECT bskyAccountID FROM account WHERE id = ? LIMIT 1;`,
    [accountId]
  );

  if (!accountRow?.bskyAccountID) {
    throw new Error("Unable to find Bluesky account for these settings");
  }

  await db.runAsync(
    `UPDATE bsky_account
     SET settingDeletePosts = ?,
         settingDeletePostsDaysOldEnabled = ?,
         settingDeletePostsDaysOld = ?,
         settingDeletePostsLikesThresholdEnabled = ?,
         settingDeletePostsLikesThreshold = ?,
         settingDeletePostsRepostsThresholdEnabled = ?,
         settingDeletePostsRepostsThreshold = ?,
         settingDeletePostsPreserveThreads = ?,
         settingDeleteReposts = ?,
         settingDeleteRepostsDaysOldEnabled = ?,
         settingDeleteRepostsDaysOld = ?,
         settingDeleteLikes = ?,
         settingDeleteLikesDaysOldEnabled = ?,
         settingDeleteLikesDaysOld = ?,
         settingDeleteBookmarks = ?,
         settingDeleteChats = ?,
         settingDeleteChatsDaysOldEnabled = ?,
         settingDeleteChatsDaysOld = ?,
         settingDeleteUnfollowEveryone = ?,
         updatedAt = ?
     WHERE id = ?;`,
    [
      settings.deletePosts ? 1 : 0,
      settings.deletePostsDaysOldEnabled ? 1 : 0,
      settings.deletePostsDaysOld,
      settings.deletePostsLikesThresholdEnabled ? 1 : 0,
      settings.deletePostsLikesThreshold,
      settings.deletePostsRepostsThresholdEnabled ? 1 : 0,
      settings.deletePostsRepostsThreshold,
      settings.deletePostsPreserveThreads ? 1 : 0,
      settings.deleteReposts ? 1 : 0,
      settings.deleteRepostsDaysOldEnabled ? 1 : 0,
      settings.deleteRepostsDaysOld,
      settings.deleteLikes ? 1 : 0,
      settings.deleteLikesDaysOldEnabled ? 1 : 0,
      settings.deleteLikesDaysOld,
      settings.deleteBookmarks ? 1 : 0,
      settings.deleteChats ? 1 : 0,
      settings.deleteChatsDaysOldEnabled ? 1 : 0,
      settings.deleteChatsDaysOld,
      settings.deleteUnfollowEveryone ? 1 : 0,
      Date.now(),
      accountRow.bskyAccountID,
    ]
  );
}

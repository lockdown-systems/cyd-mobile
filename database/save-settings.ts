import { getDatabase } from "./index";

export type AccountSaveSettings = {
  posts: boolean;
  likes: boolean;
  bookmarks: boolean;
  chat: boolean;
  following: boolean;
};

const DEFAULT_SAVE_SETTINGS: AccountSaveSettings = {
  posts: true,
  likes: true,
  bookmarks: true,
  chat: false,
  following: true,
};

type SaveSettingsRow = {
  settingSavePosts: number | null;
  settingSaveLikes: number | null;
  settingSaveBookmarks: number | null;
  settingSaveChats: number | null;
  settingSaveFollowing: number | null;
};

function mapRowToSettings(row: SaveSettingsRow | null): AccountSaveSettings {
  if (!row) {
    return { ...DEFAULT_SAVE_SETTINGS };
  }

  return {
    posts: Boolean(row.settingSavePosts),
    likes: Boolean(row.settingSaveLikes),
    bookmarks: Boolean(row.settingSaveBookmarks),
    chat: Boolean(row.settingSaveChats),
    following: Boolean(row.settingSaveFollowing),
  };
}

export async function getAccountSaveSettings(
  accountId: number
): Promise<AccountSaveSettings> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<SaveSettingsRow>(
    `SELECT 
       b.settingSavePosts,
       b.settingSaveLikes,
       b.settingSaveBookmarks,
       b.settingSaveChat,
       b.settingSaveFollowing
     FROM bsky_account b
     INNER JOIN account a ON a.bskyAccountID = b.id
     WHERE a.id = ?
     LIMIT 1;`,
    [accountId]
  );

  if (!row) {
    throw new Error("Unable to load save settings for this account");
  }

  return mapRowToSettings(row);
}

export async function updateAccountSaveSettings(
  accountId: number,
  settings: AccountSaveSettings
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
     SET settingSavePosts = ?,
         settingSaveLikes = ?,
         settingSaveBookmarks = ?,
         settingSaveChats = ?,
         settingSaveFollowing = ?,
         updatedAt = ?
     WHERE id = ?;`,
    [
      settings.posts ? 1 : 0,
      settings.likes ? 1 : 0,
      settings.bookmarks ? 1 : 0,
      settings.chat ? 1 : 0,
      settings.following ? 1 : 0,
      Date.now(),
      accountRow.bskyAccountID,
    ]
  );
}

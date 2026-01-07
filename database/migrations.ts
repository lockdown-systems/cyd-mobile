export type Migration = {
  version: number;
  name: string;
  statements: string[];
};

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial account + bsky schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS bsky_account (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        accessedAt INTEGER,
        handle TEXT NOT NULL UNIQUE,
        displayName TEXT,
        postsCount INTEGER DEFAULT 0,
        settingSavePosts INTEGER DEFAULT 1,
        settingSaveLikes INTEGER DEFAULT 1,
        settingSaveBookmarks INTEGER DEFAULT 1,
        settingSaveChats INTEGER DEFAULT 1,
        settingDeletePosts INTEGER DEFAULT 1,
        settingDeletePostsDaysOldEnabled INTEGER DEFAULT 1,
        settingDeletePostsDaysOld INTEGER DEFAULT 30,
        settingDeletePostsLikesThresholdEnabled INTEGER DEFAULT 0,
        settingDeletePostsLikesThreshold INTEGER DEFAULT 100,
        settingDeletePostsRepostsThresholdEnabled INTEGER DEFAULT 0,
        settingDeletePostsRepostsThreshold INTEGER DEFAULT 100,
        settingDeletePostsPreserveThreads INTEGER DEFAULT 1,
        settingDeleteReposts INTEGER DEFAULT 1,
        settingDeleteRepostsDaysOldEnabled INTEGER DEFAULT 1,
        settingDeleteRepostsDaysOld INTEGER DEFAULT 30,
        settingDeleteLikes INTEGER DEFAULT 1,
        settingDeleteLikesDaysOldEnabled INTEGER DEFAULT 1,
        settingDeleteLikesDaysOld INTEGER DEFAULT 30,
        settingDeleteChats INTEGER DEFAULT 1,
        settingDeleteChatsDaysOldEnabled INTEGER DEFAULT 1,
        settingDeleteChatsDaysOld INTEGER DEFAULT 14,
        settingDeleteBookmarks INTEGER DEFAULT 0,
        settingDeleteUnfollowEveryone INTEGER DEFAULT 0,
        avatarDataURI TEXT
      );`,
      `CREATE TABLE IF NOT EXISTS account (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL UNIQUE,
        sortOrder INTEGER DEFAULT 0,
        type TEXT NOT NULL CHECK (type IN ('bluesky')),
        bskyAccountID INTEGER NOT NULL UNIQUE,
        FOREIGN KEY (bskyAccountID) REFERENCES bsky_account(id) ON DELETE CASCADE
      );`,
      `CREATE INDEX IF NOT EXISTS idx_account_sort_order ON account(sortOrder ASC, id ASC);`,
    ],
  },
  {
    version: 2,
    name: "store bluesky oauth session",
    statements: [
      `ALTER TABLE bsky_account ADD COLUMN did TEXT;`,
      `ALTER TABLE bsky_account ADD COLUMN accessJwt TEXT;`,
      `ALTER TABLE bsky_account ADD COLUMN refreshJwt TEXT;`,
      `ALTER TABLE bsky_account ADD COLUMN sessionJson TEXT;`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_bsky_account_did ON bsky_account(did);`,
    ],
  },
  {
    version: 3,
    name: "add cyd account credentials",
    statements: [
      `CREATE TABLE IF NOT EXISTS cyd_account (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        userEmail TEXT,
        deviceToken TEXT,
        deviceUUID TEXT,
        createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );`,
      `INSERT OR IGNORE INTO cyd_account (id) VALUES (1);`,
    ],
  },
  {
    version: 4,
    name: "add lastSavedAt to bsky_account",
    statements: [`ALTER TABLE bsky_account ADD COLUMN lastSavedAt INTEGER;`],
  },
];

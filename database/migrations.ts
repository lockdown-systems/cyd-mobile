export type Migration = {
  version: number;
  name: string;
  statements: string[];
};

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial schema",
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
        avatarUrl TEXT,
        did TEXT,
        accessJwt TEXT,
        refreshJwt TEXT,
        sessionJson TEXT,
        lastSavedAt INTEGER
      );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_bsky_account_did ON bsky_account(did);`,
      `CREATE TABLE IF NOT EXISTS account (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL UNIQUE,
        sortOrder INTEGER DEFAULT 0,
        type TEXT NOT NULL CHECK (type IN ('bluesky')),
        bskyAccountID INTEGER NOT NULL UNIQUE,
        FOREIGN KEY (bskyAccountID) REFERENCES bsky_account(id) ON DELETE CASCADE
      );`,
      `CREATE INDEX IF NOT EXISTS idx_account_sort_order ON account(sortOrder ASC, id ASC);`,
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
    version: 2,
    name: "add lastDeletedAt column",
    statements: [`ALTER TABLE bsky_account ADD COLUMN lastDeletedAt INTEGER;`],
  },
  {
    version: 3,
    name: "add lastScheduledDeletionAt column",
    statements: [
      `ALTER TABLE bsky_account ADD COLUMN lastScheduledDeletionAt INTEGER;`,
    ],
  },
  {
    version: 4,
    name: "add schedule deletion settings",
    statements: [
      `ALTER TABLE bsky_account ADD COLUMN settingScheduleDeletion INTEGER DEFAULT 0;`,
      `ALTER TABLE bsky_account ADD COLUMN settingScheduleDeletionFrequency TEXT DEFAULT 'weekly';`,
      `ALTER TABLE bsky_account ADD COLUMN settingScheduleDeletionDayOfMonth INTEGER DEFAULT 1;`,
      `ALTER TABLE bsky_account ADD COLUMN settingScheduleDeletionDayOfWeek INTEGER DEFAULT 0;`,
      `ALTER TABLE bsky_account ADD COLUMN settingScheduleDeletionTime TEXT DEFAULT '09:00';`,
    ],
  },
];

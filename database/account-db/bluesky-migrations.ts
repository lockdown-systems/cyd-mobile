/**
 * Migrations for Bluesky account-specific databases.
 * Each account has its own SQLite database to store posts, likes, etc.
 */

export type AccountMigration = {
  version: number;
  name: string;
  statements: string[];
};

export const blueskyAccountMigrations: AccountMigration[] = [
  {
    version: 1,
    name: "initial bluesky account schema",
    statements: [
      // Configuration key-value store
      `CREATE TABLE IF NOT EXISTS config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL
      );`,

      // Job queue for tracking save/delete operations
      `CREATE TABLE IF NOT EXISTS job (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jobType TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
        scheduledAt INTEGER NOT NULL,
        startedAt INTEGER,
        finishedAt INTEGER,
        progressJSON TEXT,
        error TEXT
      );`,

      // User profiles (for authors, followed accounts, chat participants)
      `CREATE TABLE IF NOT EXISTS profile (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        did TEXT NOT NULL UNIQUE,
        handle TEXT NOT NULL,
        displayName TEXT,
        avatarUrl TEXT,
        savedAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_profile_handle ON profile(handle);`,

      // Posts (user's own posts and reposts)
      `CREATE TABLE IF NOT EXISTS post (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uri TEXT NOT NULL UNIQUE,
        cid TEXT NOT NULL,
        authorDid TEXT NOT NULL,

        -- Post content
        text TEXT NOT NULL,
        facetsJSON TEXT,
        embedType TEXT,
        embedJSON TEXT,
        langs TEXT,

        -- Reply info
        isReply INTEGER NOT NULL DEFAULT 0,
        replyParentUri TEXT,
        replyRootUri TEXT,

        -- Quote post info
        isQuote INTEGER NOT NULL DEFAULT 0,
        quotedPostUri TEXT,

        -- Repost info (if this is a repost by the user)
        isRepost INTEGER NOT NULL DEFAULT 0,
        repostUri TEXT,
        repostCid TEXT,
        originalPostUri TEXT,

        -- Engagement counts (at time of indexing)
        likeCount INTEGER NOT NULL DEFAULT 0,
        repostCount INTEGER NOT NULL DEFAULT 0,
        replyCount INTEGER NOT NULL DEFAULT 0,
        quoteCount INTEGER NOT NULL DEFAULT 0,

        -- Viewer state (at time of indexing)
        viewerLiked INTEGER DEFAULT 0,
        viewerReposted INTEGER DEFAULT 0,
        viewerBookmarked INTEGER DEFAULT 0,

        -- Timestamps
        createdAt TEXT NOT NULL,
        savedAt INTEGER NOT NULL,

        -- Deletion tracking
        deletedPostAt INTEGER,
        deletedRepostAt INTEGER,
        deletedLikeAt INTEGER,
        deletedBookmarkAt INTEGER,
        likeUri TEXT,

        -- Preservation
        preserve INTEGER NOT NULL DEFAULT 0,

        FOREIGN KEY (authorDid) REFERENCES profile(did)
      );`,
      `CREATE INDEX IF NOT EXISTS idx_post_author ON post(authorDid);`,
      `CREATE INDEX IF NOT EXISTS idx_post_created ON post(createdAt);`,
      `CREATE INDEX IF NOT EXISTS idx_post_is_repost ON post(isRepost);`,
      `CREATE INDEX IF NOT EXISTS idx_post_viewer_liked ON post(viewerLiked);`,
      `CREATE INDEX IF NOT EXISTS idx_post_viewer_bookmarked ON post(viewerBookmarked);`,
      `CREATE INDEX IF NOT EXISTS idx_post_preserve ON post(preserve);`,

      // Post media (images, videos attached to posts)
      `CREATE TABLE IF NOT EXISTS post_media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        postUri TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,

        -- Media info
        mediaType TEXT NOT NULL CHECK (mediaType IN ('image', 'video')),
        blobCid TEXT NOT NULL,
        mimeType TEXT,
        alt TEXT,

        -- Dimensions
        width INTEGER,
        height INTEGER,
        aspectRatioWidth INTEGER,
        aspectRatioHeight INTEGER,

        -- URLs from API
        thumbUrl TEXT,
        fullsizeUrl TEXT,
        playlistUrl TEXT,

        downloadedAt INTEGER,

        FOREIGN KEY (postUri) REFERENCES post(uri),
        UNIQUE(postUri, position)
      );`,
      `CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media(postUri);`,

      // External links embedded in posts (no FK constraint to allow quoted posts)
      `CREATE TABLE IF NOT EXISTS post_external (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        postUri TEXT NOT NULL UNIQUE,
        uri TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        thumbUrl TEXT,
        thumbLocalPath TEXT
      );`,

      // Bookmarks
      `CREATE TABLE IF NOT EXISTS bookmark (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subjectUri TEXT NOT NULL UNIQUE,

        -- Denormalized post info for display
        postAuthorDid TEXT,
        postAuthorHandle TEXT,
        postText TEXT,
        postCreatedAt TEXT,

        savedAt INTEGER NOT NULL,
        deletedAt INTEGER
      );`,
      `CREATE INDEX IF NOT EXISTS idx_bookmark_created ON bookmark(postCreatedAt);`,

      // Following list
      `CREATE TABLE IF NOT EXISTS follow (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uri TEXT NOT NULL UNIQUE,
        cid TEXT NOT NULL,
        subjectDid TEXT NOT NULL,

        -- Denormalized profile info
        handle TEXT NOT NULL,
        displayName TEXT,
        avatarUrl TEXT,

        createdAt TEXT NOT NULL,
        savedAt INTEGER NOT NULL,
        unfollowedAt INTEGER,

        FOREIGN KEY (subjectDid) REFERENCES profile(did)
      );`,
      `CREATE INDEX IF NOT EXISTS idx_follow_subject ON follow(subjectDid);`,
      `CREATE INDEX IF NOT EXISTS idx_follow_handle ON follow(handle);`,

      // Chat conversations
      `CREATE TABLE IF NOT EXISTS conversation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        convoId TEXT NOT NULL UNIQUE,
        rev TEXT,

        -- Participants (JSON array of DIDs)
        memberDids TEXT NOT NULL,

        -- Status
        muted INTEGER NOT NULL DEFAULT 0,

        -- Last message preview
        lastMessageId TEXT,
        lastMessageText TEXT,
        lastMessageSentAt TEXT,
        lastMessageSenderDid TEXT,

        savedAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        leftAt INTEGER
      );`,
      `CREATE INDEX IF NOT EXISTS idx_conversation_updated ON conversation(updatedAt);`,

      // Chat messages
      `CREATE TABLE IF NOT EXISTS message (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        messageId TEXT NOT NULL UNIQUE,
        convoId TEXT NOT NULL,
        rev TEXT,

        -- Sender
        senderDid TEXT NOT NULL,

        -- Content
        text TEXT NOT NULL,
        facetsJSON TEXT,
        embedJSON TEXT,

        sentAt TEXT NOT NULL,
        savedAt INTEGER NOT NULL,
        deletedAt INTEGER,

        FOREIGN KEY (convoId) REFERENCES conversation(convoId),
        FOREIGN KEY (senderDid) REFERENCES profile(did)
      );`,
      `CREATE INDEX IF NOT EXISTS idx_message_convo ON message(convoId);`,
      `CREATE INDEX IF NOT EXISTS idx_message_sender ON message(senderDid);`,
      `CREATE INDEX IF NOT EXISTS idx_message_sent ON message(sentAt);`,
    ],
  },
];

/**
 * Apply pending migrations to an account database
 */
export function applyAccountMigrations(
  db: {
    getFirstSync: <T>(sql: string) => T | null;
    execSync: (sql: string) => void;
    withTransactionSync: (fn: () => void) => void;
  },
  migrations: AccountMigration[]
): void {
  const result = db.getFirstSync<{ user_version: number }>(
    "PRAGMA user_version;"
  );
  const currentVersion = result?.user_version ?? 0;

  const pending = migrations
    .filter((migration) => migration.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    db.withTransactionSync(() => {
      for (const statement of migration.statements) {
        db.execSync(statement);
      }
      db.execSync(`PRAGMA user_version = ${migration.version};`);
    });
  }
}

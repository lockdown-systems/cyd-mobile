import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import { unzip } from "react-native-zip-archive";

import { buildAccountPaths } from "@/controllers/BaseAccountController";
import { getDatabase } from "@/database";

/**
 * Expected structure of account data in metadata.json
 */
export type ArchiveAccountData = {
  createdAt: number;
  updatedAt: number;
  accessedAt: number | null;
  handle: string;
  displayName: string | null;
  postsCount: number;
  settingSavePosts: number;
  settingSaveLikes: number;
  settingSaveBookmarks: number;
  settingSaveChats: number;
  settingDeletePosts: number;
  settingDeletePostsDaysOldEnabled: number;
  settingDeletePostsDaysOld: number;
  settingDeletePostsLikesThresholdEnabled: number;
  settingDeletePostsLikesThreshold: number;
  settingDeletePostsRepostsThresholdEnabled: number;
  settingDeletePostsRepostsThreshold: number;
  settingDeletePostsPreserveThreads: number;
  settingDeleteReposts: number;
  settingDeleteRepostsDaysOldEnabled: number;
  settingDeleteRepostsDaysOld: number;
  settingDeleteLikes: number;
  settingDeleteLikesDaysOldEnabled: number;
  settingDeleteLikesDaysOld: number;
  settingDeleteChats: number;
  settingDeleteChatsDaysOldEnabled: number;
  settingDeleteChatsDaysOld: number;
  settingDeleteBookmarks: number;
  settingDeleteUnfollowEveryone: number;
  avatarUrl: string | null;
  did: string | null;
  lastSavedAt: number | null;
};

/**
 * Expected structure of metadata.json in a Cyd archive
 */
export type ArchiveMetadata = {
  type: string;
  uuid: string;
  exportTimestamp: string;
  account: ArchiveAccountData;
};

/**
 * Result of archive validation
 */
export type ArchiveValidationResult =
  | { valid: true; metadata: ArchiveMetadata; tempDir: string }
  | { valid: false; error: string; tempDir?: string };

/**
 * Result of archive import
 */
export type ArchiveImportResult =
  | { success: true; accountUuid: string }
  | { success: false; error: string };

/**
 * Required fields in account data
 */
const REQUIRED_ACCOUNT_FIELDS: (keyof ArchiveAccountData)[] = [
  "createdAt",
  "updatedAt",
  "handle",
  "postsCount",
  "settingSavePosts",
  "settingSaveLikes",
  "settingSaveBookmarks",
  "settingSaveChats",
  "settingDeletePosts",
  "settingDeletePostsDaysOldEnabled",
  "settingDeletePostsDaysOld",
  "settingDeletePostsLikesThresholdEnabled",
  "settingDeletePostsLikesThreshold",
  "settingDeletePostsRepostsThresholdEnabled",
  "settingDeletePostsRepostsThreshold",
  "settingDeletePostsPreserveThreads",
  "settingDeleteReposts",
  "settingDeleteRepostsDaysOldEnabled",
  "settingDeleteRepostsDaysOld",
  "settingDeleteLikes",
  "settingDeleteLikesDaysOldEnabled",
  "settingDeleteLikesDaysOld",
  "settingDeleteChats",
  "settingDeleteChatsDaysOldEnabled",
  "settingDeleteChatsDaysOld",
  "settingDeleteBookmarks",
  "settingDeleteUnfollowEveryone",
];

/**
 * Result of filename validation
 */
export type FilenameValidationResult =
  | { valid: true; filename: string }
  | { valid: false; error: string };

/**
 * Regex pattern for valid archive filenames
 * Format: Cyd-archive_{YYYY-MM-DD}_Bluesky_{handle}.zip
 */
const ARCHIVE_FILENAME_PATTERN =
  /^Cyd-archive_\d{4}-\d{2}-\d{2}_Bluesky_[a-zA-Z0-9._-]+\.zip$/;

/**
 * Validate the filename of an archive
 */
export function validateArchiveFilename(
  filename: string
): FilenameValidationResult {
  if (!filename) {
    return {
      valid: false,
      error: "Could not determine filename from the selected file.",
    };
  }

  if (!ARCHIVE_FILENAME_PATTERN.test(filename)) {
    return {
      valid: false,
      error:
        "Invalid archive filename. Expected format: Cyd-archive_YYYY-MM-DD_Bluesky_{handle}.zip",
    };
  }

  return { valid: true, filename };
}

/**
 * Result from picking an archive file
 */
export type PickArchiveResult = {
  uri: string;
  filename: string;
} | null;

/**
 * Pick a zip file using the document picker
 */
export async function pickArchiveFile(): Promise<PickArchiveResult> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "application/zip",
    copyToCacheDirectory: true,
  });

  if (result.canceled || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    filename: asset.name ?? "",
  };
}

/**
 * Clean up a temporary directory
 */
export function cleanupTempDir(tempDir: string): void {
  try {
    const dir = new Directory(tempDir);
    if (dir.exists) {
      dir.delete();
    }
  } catch (err) {
    console.warn("[ArchiveImport] Failed to cleanup temp directory", err);
  }
}

/**
 * Validate an archive file and return the metadata if valid
 */
export async function validateArchive(
  zipPath: string
): Promise<ArchiveValidationResult> {
  const tempId = Crypto.randomUUID();
  const cacheBase = Paths.cache?.uri ?? "";
  const tempDir = `${cacheBase}archive-import-${tempId}`;

  try {
    // Unzip the file
    await unzip(zipPath, tempDir);

    // Find the actual content directory (zip might have a root folder)
    const rootDir = new Directory(tempDir);
    if (!rootDir.exists) {
      return { valid: false, error: "Failed to extract archive", tempDir };
    }

    // Check if files are directly in tempDir or in a subdirectory
    let contentDir = tempDir;
    const items = rootDir.list();

    // If there's exactly one directory and no files, use that as the content dir
    if (items.length === 1 && items[0] instanceof Directory) {
      contentDir = items[0].uri;
    }

    // Check for required files
    const metadataFile = new File(contentDir, "metadata.json");
    const dataDbFile = new File(contentDir, "data.db");

    if (!metadataFile.exists) {
      return {
        valid: false,
        error:
          "Invalid archive: missing metadata.json. This does not appear to be a Cyd archive.",
        tempDir,
      };
    }

    if (!dataDbFile.exists) {
      return {
        valid: false,
        error:
          "Invalid archive: missing data.db. This does not appear to be a Cyd archive.",
        tempDir,
      };
    }

    // Parse and validate metadata
    const metadataContent = await metadataFile.text();
    let metadata: unknown;
    try {
      metadata = JSON.parse(metadataContent);
    } catch {
      return {
        valid: false,
        error: "Invalid archive: metadata.json is not valid JSON.",
        tempDir,
      };
    }

    if (typeof metadata !== "object" || metadata === null) {
      return {
        valid: false,
        error: "Invalid archive: metadata.json must be an object.",
        tempDir,
      };
    }

    const meta = metadata as Record<string, unknown>;

    // Validate required top-level fields
    if (typeof meta.type !== "string" || meta.type.length === 0) {
      return {
        valid: false,
        error: "Invalid archive: metadata.json must have a valid 'type' field.",
        tempDir,
      };
    }

    if (meta.type !== "bluesky") {
      return {
        valid: false,
        error: "This version of Cyd only supports importing Bluesky archives.",
        tempDir,
      };
    }

    if (typeof meta.uuid !== "string" || meta.uuid.length === 0) {
      return {
        valid: false,
        error: "Invalid archive: metadata.json must have a valid 'uuid' field.",
        tempDir,
      };
    }

    // Validate UUID format (basic check)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(meta.uuid)) {
      return {
        valid: false,
        error: "Invalid archive: 'uuid' is not a valid UUID format.",
        tempDir,
      };
    }

    if (
      typeof meta.exportTimestamp !== "string" ||
      meta.exportTimestamp.length === 0
    ) {
      return {
        valid: false,
        error:
          "Invalid archive: metadata.json must have a valid 'exportTimestamp' field.",
        tempDir,
      };
    }

    // Validate exportTimestamp is a valid ISO date
    const timestamp = Date.parse(meta.exportTimestamp);
    if (isNaN(timestamp)) {
      return {
        valid: false,
        error:
          "Invalid archive: 'exportTimestamp' is not a valid ISO timestamp.",
        tempDir,
      };
    }

    // Validate account object
    if (typeof meta.account !== "object" || meta.account === null) {
      return {
        valid: false,
        error:
          "Invalid archive: metadata.json must have an 'account' object with account data.",
        tempDir,
      };
    }

    const account = meta.account as Record<string, unknown>;

    // Validate required account fields
    for (const field of REQUIRED_ACCOUNT_FIELDS) {
      if (!(field in account)) {
        return {
          valid: false,
          error: `Invalid archive: account data is missing required field '${field}'.`,
          tempDir,
        };
      }
    }

    // Validate handle is a string
    if (typeof account.handle !== "string" || account.handle.length === 0) {
      return {
        valid: false,
        error: "Invalid archive: account 'handle' must be a non-empty string.",
        tempDir,
      };
    }

    return {
      valid: true,
      metadata: {
        type: meta.type,
        uuid: meta.uuid,
        exportTimestamp: meta.exportTimestamp,
        account: account as unknown as ArchiveAccountData,
      },
      tempDir: contentDir, // Use the content directory, not the root temp dir
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      error: `Failed to validate archive: ${message}`,
      tempDir,
    };
  }
}

/**
 * Check if an account with the given UUID already exists
 */
export async function accountExistsWithUuid(uuid: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM account WHERE uuid = ?;",
    [uuid]
  );
  return (row?.count ?? 0) > 0;
}

/**
 * Import an archive into Cyd
 */
export async function importArchive(
  metadata: ArchiveMetadata,
  tempDir: string
): Promise<ArchiveImportResult> {
  const { uuid, account } = metadata;

  try {
    // Check if account already exists
    if (await accountExistsWithUuid(uuid)) {
      return {
        success: false,
        error:
          "You already have this account loaded into Cyd. If you want to restore the data from this archive, first delete the existing account.",
      };
    }

    const db = await getDatabase();

    // Get next sort order
    const sortOrderRow = await db.getFirstAsync<{ nextOrder: number }>(
      "SELECT COALESCE(MAX(sortOrder), -1) + 1 AS nextOrder FROM account;"
    );
    const sortOrder = sortOrderRow?.nextOrder ?? 0;

    // Insert bsky_account record using prepared statements
    const bskyResult = await db.runAsync(
      `INSERT INTO bsky_account (
        createdAt,
        updatedAt,
        accessedAt,
        handle,
        displayName,
        postsCount,
        settingSavePosts,
        settingSaveLikes,
        settingSaveBookmarks,
        settingSaveChats,
        settingDeletePosts,
        settingDeletePostsDaysOldEnabled,
        settingDeletePostsDaysOld,
        settingDeletePostsLikesThresholdEnabled,
        settingDeletePostsLikesThreshold,
        settingDeletePostsRepostsThresholdEnabled,
        settingDeletePostsRepostsThreshold,
        settingDeletePostsPreserveThreads,
        settingDeleteReposts,
        settingDeleteRepostsDaysOldEnabled,
        settingDeleteRepostsDaysOld,
        settingDeleteLikes,
        settingDeleteLikesDaysOldEnabled,
        settingDeleteLikesDaysOld,
        settingDeleteChats,
        settingDeleteChatsDaysOldEnabled,
        settingDeleteChatsDaysOld,
        settingDeleteBookmarks,
        settingDeleteUnfollowEveryone,
        avatarUrl,
        did,
        lastSavedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        account.createdAt,
        account.updatedAt,
        account.accessedAt,
        account.handle,
        account.displayName,
        account.postsCount,
        account.settingSavePosts,
        account.settingSaveLikes,
        account.settingSaveBookmarks,
        account.settingSaveChats,
        account.settingDeletePosts,
        account.settingDeletePostsDaysOldEnabled,
        account.settingDeletePostsDaysOld,
        account.settingDeletePostsLikesThresholdEnabled,
        account.settingDeletePostsLikesThreshold,
        account.settingDeletePostsRepostsThresholdEnabled,
        account.settingDeletePostsRepostsThreshold,
        account.settingDeletePostsPreserveThreads,
        account.settingDeleteReposts,
        account.settingDeleteRepostsDaysOldEnabled,
        account.settingDeleteRepostsDaysOld,
        account.settingDeleteLikes,
        account.settingDeleteLikesDaysOldEnabled,
        account.settingDeleteLikesDaysOld,
        account.settingDeleteChats,
        account.settingDeleteChatsDaysOldEnabled,
        account.settingDeleteChatsDaysOld,
        account.settingDeleteBookmarks,
        account.settingDeleteUnfollowEveryone,
        account.avatarUrl,
        account.did,
        account.lastSavedAt,
      ]
    );

    const bskyAccountID = bskyResult.lastInsertRowId;

    // Insert account record
    await db.runAsync(
      `INSERT INTO account (uuid, sortOrder, type, bskyAccountID)
       VALUES (?, ?, 'bluesky', ?);`,
      [uuid, sortOrder, bskyAccountID]
    );

    // Copy files to account directory
    const accountPaths = buildAccountPaths("bluesky", uuid);
    const accountDir = new Directory(accountPaths.accountDir);

    if (!accountDir.exists) {
      accountDir.create({ intermediates: true, idempotent: true });
    }

    // Copy all files from temp directory to account directory
    const tempDirObj = new Directory(tempDir);
    const items = tempDirObj.list();

    for (const item of items) {
      if (item instanceof File) {
        // Skip metadata.json - we'll write a fresh one
        if (item.name === "metadata.json") {
          continue;
        }
        item.copy(new File(accountDir, item.name));
      } else if (item instanceof Directory) {
        copyDirectoryRecursive(item, new Directory(accountDir, item.name));
      }
    }

    // Write a fresh metadata.json without the account data (matches what initDB creates)
    const metadataFile = new File(accountDir, "metadata.json");
    metadataFile.write(
      JSON.stringify(
        {
          type: "bluesky",
          uuid: uuid,
        },
        null,
        2
      )
    );

    return { success: true, accountUuid: uuid };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to import archive: ${message}` };
  }
}

/**
 * Recursively copy a directory
 */
function copyDirectoryRecursive(source: Directory, dest: Directory): void {
  if (!dest.exists) {
    dest.create({ intermediates: true, idempotent: true });
  }
  const items = source.list();
  for (const item of items) {
    if (item instanceof File) {
      item.copy(new File(dest, item.name));
    } else if (item instanceof Directory) {
      copyDirectoryRecursive(item, new Directory(dest, item.name));
    }
  }
}

/**
 * @fileoverview Tests for archive-import service
 */

import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { unzip } from "react-native-zip-archive";

import { getDatabase } from "@/database";
import {
  accountExistsWithUuid,
  ArchiveMetadata,
  cleanupTempDir,
  importArchive,
  pickArchiveFile,
  validateArchive,
  validateArchiveFilename,
} from "../archive-import";

// Mock expo-crypto
jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => "test-random-uuid"),
}));

// Mock expo-document-picker
jest.mock("expo-document-picker", () => ({
  getDocumentAsync: jest.fn(),
}));

// Mock react-native-zip-archive
jest.mock("react-native-zip-archive", () => ({
  unzip: jest.fn(),
}));

// Mock database
jest.mock("@/database", () => ({
  getDatabase: jest.fn(),
}));

// Mock expo-file-system
const mockFileInstances = new Map<
  string,
  { exists: boolean; content?: string }
>();
const mockDirInstances = new Map<
  string,
  { exists: boolean; items: { type: "file" | "dir"; name: string }[] }
>();

let mockFileWriteData: { path: string; content: string }[] = [];
let mockFileCopyData: { from: string; to: string }[] = [];
let mockDirCreateData: string[] = [];
let mockDirDeleteData: string[] = [];

jest.mock("expo-file-system", () => {
  return {
    Paths: {
      cache: { uri: "/cache/" },
    },
    Directory: jest
      .fn()
      .mockImplementation((path: string, subPath?: string) => {
        const fullPath = subPath ? `${path}/${subPath}` : path;
        return {
          uri: fullPath,
          get exists() {
            const data = mockDirInstances.get(fullPath);
            return data?.exists ?? false;
          },
          list: (): unknown[] => {
            const data = mockDirInstances.get(fullPath);
            if (!data) return [];
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const expoFs = jest.requireMock("expo-file-system");
            return data.items.map((item) => {
              if (item.type === "file") {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                return new expoFs.File(fullPath, item.name) as unknown;
              } else {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                return new expoFs.Directory(fullPath, item.name) as unknown;
              }
            });
          },
          delete: () => {
            mockDirDeleteData.push(fullPath);
          },
          create: () => {
            mockDirCreateData.push(fullPath);
          },
          name: fullPath.split("/").pop() || "",
        };
      }),
    File: jest.fn().mockImplementation((dir: unknown, name?: string) => {
      const dirUri =
        typeof dir === "string" ? dir : (dir as { uri: string }).uri;
      const fullPath = name ? `${dirUri}/${name}` : dirUri;
      return {
        uri: fullPath,
        name: fullPath.split("/").pop() || "",
        get exists() {
          const data = mockFileInstances.get(fullPath);
          return data?.exists ?? false;
        },
        text: async () => {
          const data = mockFileInstances.get(fullPath);
          return data?.content ?? "";
        },
        write: (content: string) => {
          mockFileWriteData.push({ path: fullPath, content });
        },
        copy: (destFile: { uri: string }) => {
          mockFileCopyData.push({ from: fullPath, to: destFile.uri });
        },
      };
    }),
  };
});

describe("archive-import", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFileInstances.clear();
    mockDirInstances.clear();
    mockFileWriteData = [];
    mockFileCopyData = [];
    mockDirCreateData = [];
    mockDirDeleteData = [];
  });

  describe("pickArchiveFile", () => {
    it("should return null when user cancels", async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: true,
        assets: [],
      });

      const result = await pickArchiveFile();
      expect(result).toBeNull();
    });

    it("should return null when no assets selected", async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [],
      });

      const result = await pickArchiveFile();
      expect(result).toBeNull();
    });

    it("should return the file URI and filename when a file is selected", async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: "/path/to/archive.zip",
            name: "Cyd-archive_2026-01-10_Bluesky_test.zip",
          },
        ],
      });

      const result = await pickArchiveFile();
      expect(result).toEqual({
        uri: "/path/to/archive.zip",
        filename: "Cyd-archive_2026-01-10_Bluesky_test.zip",
      });
    });

    it("should request zip files only", async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: true,
        assets: [],
      });

      await pickArchiveFile();

      expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({
        type: "application/zip",
        copyToCacheDirectory: true,
      });
    });
  });

  describe("validateArchiveFilename", () => {
    it("should accept valid filename with simple handle", () => {
      const result = validateArchiveFilename(
        "Cyd-archive_2026-01-10_Bluesky_test.bsky.social.zip"
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.filename).toBe(
          "Cyd-archive_2026-01-10_Bluesky_test.bsky.social.zip"
        );
      }
    });

    it("should accept valid filename with complex handle", () => {
      const result = validateArchiveFilename(
        "Cyd-archive_2025-12-31_Bluesky_my-user_name.bsky.social.zip"
      );
      expect(result.valid).toBe(true);
    });

    it("should accept filename with hyphens and underscores in handle", () => {
      const result = validateArchiveFilename(
        "Cyd-archive_2026-01-10_Bluesky_nexamind-cyd.bsky.social.zip"
      );
      expect(result.valid).toBe(true);
    });

    it("should reject filename without Cyd-archive prefix", () => {
      const result = validateArchiveFilename(
        "archive_2026-01-10_Bluesky_test.bsky.social.zip"
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("Invalid archive filename");
      }
    });

    it("should reject filename with wrong date format", () => {
      const result = validateArchiveFilename(
        "Cyd-archive_01-10-2026_Bluesky_test.bsky.social.zip"
      );
      expect(result.valid).toBe(false);
    });

    it("should reject filename without Bluesky marker", () => {
      const result = validateArchiveFilename(
        "Cyd-archive_2026-01-10_Twitter_test.bsky.social.zip"
      );
      expect(result.valid).toBe(false);
    });

    it("should reject filename without handle", () => {
      const result = validateArchiveFilename(
        "Cyd-archive_2026-01-10_Bluesky_.zip"
      );
      expect(result.valid).toBe(false);
    });

    it("should reject filename without .zip extension", () => {
      const result = validateArchiveFilename(
        "Cyd-archive_2026-01-10_Bluesky_test.bsky.social"
      );
      expect(result.valid).toBe(false);
    });

    it("should reject random zip filename", () => {
      const result = validateArchiveFilename("my-backup.zip");
      expect(result.valid).toBe(false);
    });

    it("should return error when filename is empty", () => {
      const result = validateArchiveFilename("");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("Could not determine filename");
      }
    });
  });

  describe("cleanupTempDir", () => {
    it("should delete the directory if it exists", () => {
      mockDirInstances.set("/temp/test-dir", { exists: true, items: [] });

      cleanupTempDir("/temp/test-dir");

      expect(mockDirDeleteData).toContain("/temp/test-dir");
    });

    it("should not throw if directory does not exist", () => {
      mockDirInstances.set("/temp/test-dir", { exists: false, items: [] });

      expect(() => cleanupTempDir("/temp/test-dir")).not.toThrow();
    });
  });

  describe("validateArchive", () => {
    const validMetadata = {
      type: "bluesky",
      uuid: "d628f5e2-44d2-465c-8b96-3529a614c2d1",
      exportTimestamp: "2026-01-11T05:28:46.071Z",
      account: {
        createdAt: 1768107605109,
        updatedAt: 1768107611531,
        accessedAt: 1768109325856,
        handle: "test.bsky.social",
        displayName: "Test User",
        postsCount: 100,
        settingSavePosts: 1,
        settingSaveLikes: 1,
        settingSaveBookmarks: 1,
        settingSaveChats: 1,
        settingDeletePosts: 1,
        settingDeletePostsDaysOldEnabled: 1,
        settingDeletePostsDaysOld: 30,
        settingDeletePostsLikesThresholdEnabled: 0,
        settingDeletePostsLikesThreshold: 100,
        settingDeletePostsRepostsThresholdEnabled: 0,
        settingDeletePostsRepostsThreshold: 100,
        settingDeletePostsPreserveThreads: 1,
        settingDeleteReposts: 1,
        settingDeleteRepostsDaysOldEnabled: 1,
        settingDeleteRepostsDaysOld: 30,
        settingDeleteLikes: 1,
        settingDeleteLikesDaysOldEnabled: 1,
        settingDeleteLikesDaysOld: 30,
        settingDeleteChats: 1,
        settingDeleteChatsDaysOldEnabled: 1,
        settingDeleteChatsDaysOld: 14,
        settingDeleteBookmarks: 0,
        settingDeleteUnfollowEveryone: 0,
        avatarDataURI: null,
        did: "did:plc:test123",
        lastSavedAt: 1768107650382,
      },
    };

    beforeEach(() => {
      (Crypto.randomUUID as jest.Mock).mockReturnValue("test-random-uuid");
      (unzip as jest.Mock).mockResolvedValue(undefined);
    });

    it("should return error if root directory does not exist after unzip", async () => {
      mockDirInstances.set("/cache/archive-import-test-random-uuid", {
        exists: false,
        items: [],
      });

      const result = await validateArchive("/path/to/archive.zip");

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Failed to extract archive");
      }
    });

    it("should return error if metadata.json is missing", async () => {
      const tempDir = "/cache/archive-import-test-random-uuid";
      mockDirInstances.set(tempDir, { exists: true, items: [] });
      mockFileInstances.set(`${tempDir}/metadata.json`, { exists: false });
      mockFileInstances.set(`${tempDir}/data.db`, { exists: true });

      const result = await validateArchive("/path/to/archive.zip");

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("missing metadata.json");
      }
    });

    it("should return error if data.db is missing", async () => {
      const tempDir = "/cache/archive-import-test-random-uuid";
      mockDirInstances.set(tempDir, { exists: true, items: [] });
      mockFileInstances.set(`${tempDir}/metadata.json`, {
        exists: true,
        content: JSON.stringify(validMetadata),
      });
      mockFileInstances.set(`${tempDir}/data.db`, { exists: false });

      const result = await validateArchive("/path/to/archive.zip");

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("missing data.db");
      }
    });

    it("should return error if metadata.json is not valid JSON", async () => {
      const tempDir = "/cache/archive-import-test-random-uuid";
      mockDirInstances.set(tempDir, { exists: true, items: [] });
      mockFileInstances.set(`${tempDir}/metadata.json`, {
        exists: true,
        content: "not valid json {{{",
      });
      mockFileInstances.set(`${tempDir}/data.db`, { exists: true });

      const result = await validateArchive("/path/to/archive.zip");

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("not valid JSON");
      }
    });

    it("should return error if type is not bluesky", async () => {
      const tempDir = "/cache/archive-import-test-random-uuid";
      mockDirInstances.set(tempDir, { exists: true, items: [] });
      mockFileInstances.set(`${tempDir}/metadata.json`, {
        exists: true,
        content: JSON.stringify({ ...validMetadata, type: "twitter" }),
      });
      mockFileInstances.set(`${tempDir}/data.db`, { exists: true });

      const result = await validateArchive("/path/to/archive.zip");

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("only supports importing Bluesky");
      }
    });

    it("should return error if uuid is invalid", async () => {
      const tempDir = "/cache/archive-import-test-random-uuid";
      mockDirInstances.set(tempDir, { exists: true, items: [] });
      mockFileInstances.set(`${tempDir}/metadata.json`, {
        exists: true,
        content: JSON.stringify({ ...validMetadata, uuid: "not-a-uuid" }),
      });
      mockFileInstances.set(`${tempDir}/data.db`, { exists: true });

      const result = await validateArchive("/path/to/archive.zip");

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("not a valid UUID");
      }
    });

    it("should return error if exportTimestamp is invalid", async () => {
      const tempDir = "/cache/archive-import-test-random-uuid";
      mockDirInstances.set(tempDir, { exists: true, items: [] });
      mockFileInstances.set(`${tempDir}/metadata.json`, {
        exists: true,
        content: JSON.stringify({
          ...validMetadata,
          exportTimestamp: "not-a-date",
        }),
      });
      mockFileInstances.set(`${tempDir}/data.db`, { exists: true });

      const result = await validateArchive("/path/to/archive.zip");

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("not a valid ISO timestamp");
      }
    });

    it("should return error if account object is missing", async () => {
      const tempDir = "/cache/archive-import-test-random-uuid";
      const { account: _account, ...metadataWithoutAccount } = validMetadata;
      mockDirInstances.set(tempDir, { exists: true, items: [] });
      mockFileInstances.set(`${tempDir}/metadata.json`, {
        exists: true,
        content: JSON.stringify(metadataWithoutAccount),
      });
      mockFileInstances.set(`${tempDir}/data.db`, { exists: true });

      const result = await validateArchive("/path/to/archive.zip");

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("'account' object");
      }
    });

    it("should return error if required account field is missing", async () => {
      const tempDir = "/cache/archive-import-test-random-uuid";
      const { handle: _handle, ...accountWithoutHandle } =
        validMetadata.account;
      mockDirInstances.set(tempDir, { exists: true, items: [] });
      mockFileInstances.set(`${tempDir}/metadata.json`, {
        exists: true,
        content: JSON.stringify({
          ...validMetadata,
          account: accountWithoutHandle,
        }),
      });
      mockFileInstances.set(`${tempDir}/data.db`, { exists: true });

      const result = await validateArchive("/path/to/archive.zip");

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("missing required field 'handle'");
      }
    });

    it("should return valid result for valid metadata", async () => {
      const tempDir = "/cache/archive-import-test-random-uuid";
      mockDirInstances.set(tempDir, { exists: true, items: [] });
      mockFileInstances.set(`${tempDir}/metadata.json`, {
        exists: true,
        content: JSON.stringify(validMetadata),
      });
      mockFileInstances.set(`${tempDir}/data.db`, { exists: true });

      const result = await validateArchive("/path/to/archive.zip");

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.metadata.type).toBe("bluesky");
        expect(result.metadata.uuid).toBe(
          "d628f5e2-44d2-465c-8b96-3529a614c2d1"
        );
        expect(result.metadata.account.handle).toBe("test.bsky.social");
      }
    });
  });

  describe("accountExistsWithUuid", () => {
    it("should return true if account exists", async () => {
      const mockDb = {
        getFirstAsync: jest.fn().mockResolvedValue({ count: 1 }),
      };
      (getDatabase as jest.Mock).mockResolvedValue(mockDb);

      const result = await accountExistsWithUuid("test-uuid");

      expect(result).toBe(true);
      expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
        "SELECT COUNT(*) as count FROM account WHERE uuid = ?;",
        ["test-uuid"]
      );
    });

    it("should return false if account does not exist", async () => {
      const mockDb = {
        getFirstAsync: jest.fn().mockResolvedValue({ count: 0 }),
      };
      (getDatabase as jest.Mock).mockResolvedValue(mockDb);

      const result = await accountExistsWithUuid("test-uuid");

      expect(result).toBe(false);
    });

    it("should return false if query returns null", async () => {
      const mockDb = {
        getFirstAsync: jest.fn().mockResolvedValue(null),
      };
      (getDatabase as jest.Mock).mockResolvedValue(mockDb);

      const result = await accountExistsWithUuid("test-uuid");

      expect(result).toBe(false);
    });
  });

  describe("importArchive", () => {
    const validMetadata: ArchiveMetadata = {
      type: "bluesky",
      uuid: "d628f5e2-44d2-465c-8b96-3529a614c2d1",
      exportTimestamp: "2026-01-11T05:28:46.071Z",
      account: {
        createdAt: 1768107605109,
        updatedAt: 1768107611531,
        accessedAt: 1768109325856,
        handle: "test.bsky.social",
        displayName: "Test User",
        postsCount: 100,
        settingSavePosts: 1,
        settingSaveLikes: 1,
        settingSaveBookmarks: 1,
        settingSaveChats: 1,
        settingDeletePosts: 1,
        settingDeletePostsDaysOldEnabled: 1,
        settingDeletePostsDaysOld: 30,
        settingDeletePostsLikesThresholdEnabled: 0,
        settingDeletePostsLikesThreshold: 100,
        settingDeletePostsRepostsThresholdEnabled: 0,
        settingDeletePostsRepostsThreshold: 100,
        settingDeletePostsPreserveThreads: 1,
        settingDeleteReposts: 1,
        settingDeleteRepostsDaysOldEnabled: 1,
        settingDeleteRepostsDaysOld: 30,
        settingDeleteLikes: 1,
        settingDeleteLikesDaysOldEnabled: 1,
        settingDeleteLikesDaysOld: 30,
        settingDeleteChats: 1,
        settingDeleteChatsDaysOldEnabled: 1,
        settingDeleteChatsDaysOld: 14,
        settingDeleteBookmarks: 0,
        settingDeleteUnfollowEveryone: 0,
        avatarDataURI: null,
        did: "did:plc:test123",
        lastSavedAt: 1768107650382,
      },
    };

    it("should return error if account with same UUID already exists", async () => {
      const mockDb = {
        getFirstAsync: jest.fn().mockResolvedValue({ count: 1 }),
      };
      (getDatabase as jest.Mock).mockResolvedValue(mockDb);

      const result = await importArchive(validMetadata, "/temp/archive");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("already have this account");
      }
    });

    it("should import archive successfully", async () => {
      const mockDb = {
        getFirstAsync: jest
          .fn()
          .mockResolvedValueOnce({ count: 0 }) // accountExistsWithUuid check
          .mockResolvedValueOnce({ nextOrder: 0 }), // sortOrder query
        runAsync: jest
          .fn()
          .mockResolvedValueOnce({ lastInsertRowId: 123 }) // bsky_account insert
          .mockResolvedValueOnce({}), // account insert
      };
      (getDatabase as jest.Mock).mockResolvedValue(mockDb);

      // Setup mock directory and files
      const tempDir = "/temp/archive";
      mockDirInstances.set(tempDir, {
        exists: true,
        items: [
          { type: "file", name: "data.db" },
          { type: "file", name: "metadata.json" },
          { type: "dir", name: "media" },
        ],
      });
      mockDirInstances.set(`${tempDir}/media`, {
        exists: true,
        items: [{ type: "file", name: "image.jpg" }],
      });

      // Mock the account directory as not existing initially
      const accountDir = `/accounts/bluesky-${validMetadata.uuid}`;
      mockDirInstances.set(accountDir, { exists: false, items: [] });

      const result = await importArchive(validMetadata, tempDir);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.accountUuid).toBe(validMetadata.uuid);
      }

      // Verify bsky_account was inserted with correct values
      expect(mockDb.runAsync).toHaveBeenCalledTimes(2);
      const bskyInsertCall = mockDb.runAsync.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(bskyInsertCall[0]).toContain("INSERT INTO bsky_account");
      expect(bskyInsertCall[1]).toContain(validMetadata.account.handle);

      // Verify account was inserted with correct values
      const accountInsertCall = mockDb.runAsync.mock.calls[1] as [
        string,
        unknown[],
      ];
      expect(accountInsertCall[0]).toContain("INSERT INTO account");
      expect(accountInsertCall[1]).toEqual([validMetadata.uuid, 0, 123]);

      // Verify metadata.json was written
      expect(
        mockFileWriteData.some((w) => w.path.includes("metadata.json"))
      ).toBe(true);
    });

    it("should write fresh metadata.json without account data after import", async () => {
      const mockDb = {
        getFirstAsync: jest
          .fn()
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValueOnce({ nextOrder: 0 }),
        runAsync: jest
          .fn()
          .mockResolvedValueOnce({ lastInsertRowId: 123 })
          .mockResolvedValueOnce({}),
      };
      (getDatabase as jest.Mock).mockResolvedValue(mockDb);

      const tempDir = "/temp/archive";
      mockDirInstances.set(tempDir, {
        exists: true,
        items: [],
      });

      const accountDir = `/accounts/bluesky-${validMetadata.uuid}`;
      mockDirInstances.set(accountDir, { exists: false, items: [] });

      await importArchive(validMetadata, tempDir);

      // Find the metadata.json write
      const metadataWrite = mockFileWriteData.find((w) =>
        w.path.includes("metadata.json")
      );
      expect(metadataWrite).toBeDefined();

      // Verify it only contains type and uuid (not account data)
      const parsedMetadata = JSON.parse(metadataWrite!.content) as {
        type?: string;
        uuid?: string;
        account?: unknown;
        exportTimestamp?: string;
      };
      expect(parsedMetadata.type).toBe("bluesky");
      expect(parsedMetadata.uuid).toBe(validMetadata.uuid);
      expect(parsedMetadata.account).toBeUndefined();
      expect(parsedMetadata.exportTimestamp).toBeUndefined();
    });

    it("should handle database errors gracefully", async () => {
      const mockDb = {
        getFirstAsync: jest.fn().mockRejectedValue(new Error("Database error")),
      };
      (getDatabase as jest.Mock).mockResolvedValue(mockDb);

      const result = await importArchive(validMetadata, "/temp/archive");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Database error");
      }
    });
  });
});

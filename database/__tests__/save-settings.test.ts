import * as databaseModule from "../index";
import {
  getAccountSaveSettings,
  updateAccountSaveSettings,
} from "../save-settings";

jest.mock("../index", () => ({
  getDatabase: jest.fn(),
}));

const getDatabase = databaseModule.getDatabase as jest.Mock;

describe("Account save settings helpers", () => {
  let mockDb: {
    getFirstAsync: jest.Mock;
    runAsync: jest.Mock;
  };

  beforeEach(() => {
    mockDb = {
      getFirstAsync: jest.fn(),
      runAsync: jest.fn(),
    };

    getDatabase.mockResolvedValue(mockDb);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("loads existing save settings", async () => {
    mockDb.getFirstAsync.mockResolvedValue({
      settingSavePosts: 1,
      settingSaveLikes: 0,
      settingSaveBookmarks: 1,
      settingSaveChat: null,
      settingSaveFollowing: 1,
    });

    const settings = await getAccountSaveSettings(7);

    expect(settings).toEqual({
      posts: true,
      likes: false,
      bookmarks: true,
      chat: false,
      following: true,
    });
    expect(mockDb.getFirstAsync).toHaveBeenCalledWith(expect.any(String), [7]);
  });

  it("throws when no settings row exists", async () => {
    mockDb.getFirstAsync.mockResolvedValue(null);

    await expect(getAccountSaveSettings(99)).rejects.toThrow(
      "Unable to load save settings"
    );
  });

  describe("updateAccountSaveSettings", () => {
    it("persists toggles for the linked Bluesky account", async () => {
      mockDb.getFirstAsync.mockResolvedValue({ bskyAccountID: 42 });

      await updateAccountSaveSettings(5, {
        posts: true,
        likes: false,
        bookmarks: true,
        chat: false,
        following: true,
      });

      expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
        expect.stringContaining("SELECT bskyAccountID"),
        [5]
      );
      expect(mockDb.runAsync).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE bsky_account"),
        [1, 0, 1, 0, 1, expect.any(Number), 42]
      );
    });

    it("throws if the account cannot be resolved", async () => {
      mockDb.getFirstAsync.mockResolvedValue(null);

      await expect(
        updateAccountSaveSettings(123, {
          posts: false,
          likes: false,
          bookmarks: false,
          chat: false,
          following: false,
        })
      ).rejects.toThrow("Unable to find Bluesky account");
      expect(mockDb.runAsync).not.toHaveBeenCalled();
    });
  });
});

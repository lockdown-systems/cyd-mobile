const mockDb = {
  execAsync: jest.fn(async () => undefined),
  getFirstAsync: jest.fn(async () => ({ user_version: 5 })),
  withTransactionAsync: jest.fn(async (callback: () => Promise<void>) =>
    callback(),
  ),
};

jest.mock("expo-sqlite", () => ({
  defaultDatabaseDirectory: "/documents/SQLite",
  openDatabaseAsync: jest.fn(async () => mockDb),
}));

jest.mock("../connection-migration", () => ({
  migrateLegacyBlueskyConnections: jest.fn(),
}));

import { migrateLegacyBlueskyConnections } from "../connection-migration";
import { getDatabase } from "../index";

describe("main database connection migration", () => {
  it("does not remove credential columns if protected migration fails", async () => {
    jest
      .mocked(migrateLegacyBlueskyConnections)
      .mockRejectedValueOnce(new Error("Keychain unavailable"));

    await expect(getDatabase()).rejects.toThrow("Keychain unavailable");

    expect(mockDb.execAsync).not.toHaveBeenCalledWith(
      expect.stringContaining("DROP COLUMN"),
    );
  });
});

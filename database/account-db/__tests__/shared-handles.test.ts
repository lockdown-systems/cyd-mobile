const opened: { path: string; closeAsync: jest.Mock; execAsync: jest.Mock }[] =
  [];

jest.mock("expo-sqlite", () => ({
  openDatabaseAsync: jest.fn(async (dbName: string, _options, dbDir: string) => {
    const db = {
      path: `${dbDir}::${dbName}`,
      closeAsync: jest.fn(async () => {}),
      execAsync: jest.fn(async () => {}),
    };
    opened.push(db);
    return db;
  }),
}));

import { openDatabaseAsync } from "expo-sqlite";

import {
  accountDatabaseRefCount,
  acquireAccountDatabase,
  releaseAccountDatabase,
} from "../shared-handles";

const DIR = "/files/accounts/bluesky-account";
const NAME = "data.db";

/**
 * One handle per account database file.
 *
 * expo-sqlite hands every caller the same native connection, and every JS
 * handle over it can close that connection when it is garbage collected. So
 * "open it again and close it when done" is not a local decision: it breaks
 * whoever else is holding the database, at whatever later moment the
 * collector runs.
 */
describe("sharing one handle per account database", () => {
  afterEach(async () => {
    // Give everything back, so one test's holders are not another's.
    while (accountDatabaseRefCount(DIR, NAME) > 0) {
      await releaseAccountDatabase(DIR, NAME);
    }
    opened.length = 0;
    jest.clearAllMocks();
  });

  it("opens the database once, however many holders it has", async () => {
    const first = await acquireAccountDatabase(DIR, NAME);
    const second = await acquireAccountDatabase(DIR, NAME);

    expect(second).toBe(first);
    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(accountDatabaseRefCount(DIR, NAME)).toBe(2);
  });

  it("does not close a database somebody else is still holding", async () => {
    const db = await acquireAccountDatabase(DIR, NAME);
    await acquireAccountDatabase(DIR, NAME);

    await releaseAccountDatabase(DIR, NAME);

    expect(db.closeAsync).not.toHaveBeenCalled();
  });

  it("closes it when the last holder gives it back", async () => {
    const db = await acquireAccountDatabase(DIR, NAME);
    await acquireAccountDatabase(DIR, NAME);

    await releaseAccountDatabase(DIR, NAME);
    await releaseAccountDatabase(DIR, NAME);

    expect(db.closeAsync).toHaveBeenCalledTimes(1);
    expect(accountDatabaseRefCount(DIR, NAME)).toBe(0);
  });

  it("opens a fresh one after the last holder let go", async () => {
    await acquireAccountDatabase(DIR, NAME);
    await releaseAccountDatabase(DIR, NAME);

    await acquireAccountDatabase(DIR, NAME);

    expect(openDatabaseAsync).toHaveBeenCalledTimes(2);
  });

  it("gives two callers arriving at once the same handle", async () => {
    const [first, second] = await Promise.all([
      acquireAccountDatabase(DIR, NAME),
      acquireAccountDatabase(DIR, NAME),
    ]);

    expect(second).toBe(first);
    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  it("keeps databases for different accounts apart", async () => {
    const mine = await acquireAccountDatabase(DIR, NAME);
    const theirs = await acquireAccountDatabase("/files/accounts/other", NAME);

    expect(theirs).not.toBe(mine);

    await releaseAccountDatabase("/files/accounts/other", NAME);
    expect(mine.closeAsync).not.toHaveBeenCalled();
  });

  it("ignores a release from somebody who never acquired", async () => {
    await expect(
      releaseAccountDatabase("/files/accounts/never-opened", NAME),
    ).resolves.toBeUndefined();
  });
});

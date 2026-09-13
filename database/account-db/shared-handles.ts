import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

/**
 * One open handle per account database file, shared for as long as anybody
 * wants it.
 *
 * expo-sqlite keeps one native connection per path and hands the same one to
 * every caller that opens it with the same options — but each JS handle also
 * *owns* that connection. Its native object is a `SharedRef` whose
 * `sharedObjectDidRelease` closes the connection, and that runs when the JS
 * handle is garbage collected, no matter who else is still holding one. So a
 * second `openDatabaseAsync` for a database the app already has open is not a
 * second connection. It is a promise that somebody's queries will start
 * failing with
 *
 *     Call to function 'NativeDatabase.prepareAsync' has been rejected.
 *     → Caused by: java.lang.NullPointerException
 *
 * at whatever later moment the collector happens to run — which is why it
 * looks like an unrelated screen breaking minutes after the work that caused
 * it.
 *
 * Everything that opens an account database goes through here: one handle per
 * file, lent out as often as it is asked for, and closed once — when the last
 * holder gives it back.
 */

type SharedHandle = {
  db: SQLiteDatabase;
  refCount: number;
  /** Serializes opens, so two callers at once cannot make two connections. */
  opening: Promise<SQLiteDatabase>;
};

const handles = new Map<string, SharedHandle>();

function keyFor(dbDir: string, dbName: string): string {
  return `${dbDir}::${dbName}`;
}

/**
 * Borrow the handle for an account database, opening it if nobody has it.
 *
 * Every caller must hand it back with `releaseAccountDatabase`, and none may
 * close it themselves: closing a borrowed handle closes it for its other
 * holders too.
 */
export async function acquireAccountDatabase(
  dbDir: string,
  dbName: string,
): Promise<SQLiteDatabase> {
  const key = keyFor(dbDir, dbName);
  const existing = handles.get(key);
  if (existing) {
    existing.refCount += 1;
    return existing.opening;
  }

  const opening = (async () => {
    const db = await openDatabaseAsync(dbName, {}, dbDir);
    await db.execAsync("PRAGMA foreign_keys = ON;");
    return db;
  })();

  // Registered before it finishes opening, so a second caller arriving while
  // the first is still awaiting waits for that one rather than starting its
  // own.
  const handle: SharedHandle = {
    db: undefined as unknown as SQLiteDatabase,
    refCount: 1,
    opening,
  };
  handles.set(key, handle);

  try {
    handle.db = await opening;
  } catch (err) {
    handles.delete(key);
    throw err;
  }
  return handle.db;
}

/**
 * Give a handle back, closing it when the last holder does.
 *
 * Releasing one nobody is holding is a no-op rather than an error: a caller
 * cleaning up after a failure should not have to know whether it got as far
 * as acquiring.
 */
export async function releaseAccountDatabase(
  dbDir: string,
  dbName: string,
): Promise<void> {
  const key = keyFor(dbDir, dbName);
  const handle = handles.get(key);
  if (!handle) {
    return;
  }

  handle.refCount -= 1;
  if (handle.refCount > 0) {
    return;
  }

  handles.delete(key);
  const db = await handle.opening.catch(() => null);
  await db?.closeAsync();
}

/** How many holders a database has, for tests and for logging. */
export function accountDatabaseRefCount(
  dbDir: string,
  dbName: string,
): number {
  return handles.get(keyFor(dbDir, dbName))?.refCount ?? 0;
}

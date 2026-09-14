import type { BlueskyInterchangeContent } from "../interchange";
import type { WritableDatabase } from "../ports";

import { writeBlueskyInterchangeDatabase } from "../database-writer";

/**
 * How `data.db` is written, rather than what ends up in it.
 *
 * The archive's own contents are covered end-to-end elsewhere. What matters
 * here is the shape of the write: an account's records go in as one
 * transaction, because outside one SQLite commits after every single row and
 * waits for the storage to confirm it — on a phone that was most of a minute
 * of an export doing nothing but waiting on fsync, with the screen frozen
 * behind it.
 */

function emptyContent(): BlueskyInterchangeContent {
  return {
    archive: { account_did: "did:plc:alice" },
    identity: { did: "did:plc:alice" },
    profiles: [],
    records: [],
    selections: [],
    recordSubjects: [],
    recordContext: [],
    conversations: [],
    conversationMembers: [],
    messages: [],
    relationships: [],
    assets: [],
    recordAssets: [],
    portableSettings: [],
    payloads: [],
    completeness: "complete",
  } as unknown as BlueskyInterchangeContent;
}

/** A database that records what it is asked to do, and can refuse a row. */
function recordingDatabase(options: { failOnRow?: number } = {}) {
  const statements: string[] = [];
  let rows = 0;
  const database: WritableDatabase = {
    exec: (sql) => {
      statements.push(sql.trim().split(/\s+/)[0].toUpperCase());
    },
    run: () => {
      rows += 1;
      if (options.failOnRow === rows) {
        throw new Error("FOREIGN KEY constraint failed");
      }
    },
    close: () => {},
  };
  return { database, statements };
}

describe("writing a Cyd Bluesky archive's data.db", () => {
  it("writes the whole account as one transaction", () => {
    const { database, statements } = recordingDatabase();

    writeBlueskyInterchangeDatabase(database, emptyContent());

    expect(statements.filter((s) => s === "BEGIN")).toHaveLength(1);
    expect(statements.filter((s) => s === "COMMIT")).toHaveLength(1);
    expect(statements).not.toContain("ROLLBACK");
    // The schema is created before the transaction opens, so a failed write
    // rolls back the rows without taking the tables with them.
    expect(statements.indexOf("CREATE")).toBeLessThan(statements.indexOf("BEGIN"));
    expect(statements.indexOf("BEGIN")).toBeLessThan(statements.indexOf("COMMIT"));
  });

  /**
   * Foreign keys stay on while this writes, so a translation bug is caught
   * here rather than on somebody else's device at import time. Catching it
   * must not leave half an account behind in a file that is about to be
   * offered to the packaging step.
   */
  it("leaves nothing behind when a row is refused", () => {
    const { database, statements } = recordingDatabase({ failOnRow: 1 });

    expect(() =>
      writeBlueskyInterchangeDatabase(database, {
        ...emptyContent(),
        profiles: [{ id: "p1" }, { id: "p2" }],
      } as unknown as BlueskyInterchangeContent),
    ).toThrow("FOREIGN KEY");

    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
  });
});

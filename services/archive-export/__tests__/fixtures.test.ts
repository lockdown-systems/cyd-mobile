import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { unzipSync } from "fflate";

import { runBlueskyArchiveIntake } from "@/services/archive-import";
import {
  createMemoryByteReader,
  createTestBlueskyArchiveIntakeEnvironment,
} from "@/testUtils/archiveFixtures";

/**
 * Guards on the committed real-data fixtures.
 *
 * These are archives Mobile's own writer produced from a curated test account
 * (ADR 0016), and `testUtils/fixtures/bluesky-archive/README.md` records where
 * they came from. Two things about them are easy to break silently and are
 * therefore checked here rather than described in prose: that Mobile can still
 * read them, and that regenerating them did not quietly inflate the
 * repository, since committed media persists in history forever.
 *
 * What they *mean* is not settled here. The pinned canonical bundle is the
 * semantic oracle (ADR 0008); `npm run test:archive-contract` is that check.
 */

const FIXTURE_DIRECTORY = path.join(
  __dirname,
  "../../../testUtils/fixtures/bluesky-archive",
);

/** Both fixtures together, against the budget the fixtures doc states. */
const SIZE_BUDGET_BYTES = 5 * 1024 * 1024;

function read(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(FIXTURE_DIRECTORY, name)));
}

function openDatabase(archive: Uint8Array): DatabaseSync {
  const extracted = path.join(
    fs.mkdtempSync(path.join(require("node:os").tmpdir(), "cyd-fixture-")),
    "data.db",
  );
  fs.writeFileSync(extracted, unzipSync(archive)["data.db"]);
  return new DatabaseSync(extracted, { readOnly: true });
}

describe("committed Cyd Bluesky archive fixtures", () => {
  it.each(["complete.cyd", "incomplete.cyd"])(
    "%s is still an archive Cyd can take in",
    async (name) => {
      const outcome = await runBlueskyArchiveIntake(
        createTestBlueskyArchiveIntakeEnvironment(),
        {
          intakeId: `fixture-${name}`,
          sourceUri: `file:///fixtures/${name}`,
          openReader: async () => createMemoryByteReader(read(name)),
        },
      );

      expect(outcome).toMatchObject({
        status: "prepared",
        metadata: {
          format: "cyd-archive",
          platform: "bluesky",
          version: 2,
          accountDid: "did:plc:yn45xekh5kqrat27w6rmafcg",
          completeness: name === "complete.cyd" ? "complete" : "incomplete",
        },
      });
    },
  );

  it("stays inside the committed size budget", () => {
    const total = ["complete.cyd", "incomplete.cyd"].reduce(
      (sum, name) => sum + fs.statSync(path.join(FIXTURE_DIRECTORY, name)).size,
      0,
    );

    expect(total).toBeLessThanOrEqual(SIZE_BUDGET_BYTES);
  });

  it("differs between the pair by one unavailable asset and nothing else", () => {
    // What makes the pair useful to a reader: anything else that differs is a
    // second variable in every test built on them.
    const complete = openDatabase(read("complete.cyd"));
    const incomplete = openDatabase(read("incomplete.cyd"));

    for (const table of [
      "identity",
      "profiles",
      "records",
      "selections",
      "record_subjects",
      "record_context",
      "conversations",
      "conversation_members",
      "messages",
      "relationships",
      "record_assets",
      "portable_settings",
    ]) {
      expect({
        table,
        rows: complete.prepare(`SELECT * FROM ${table}`).all(),
      }).toEqual({
        table,
        rows: incomplete.prepare(`SELECT * FROM ${table}`).all(),
      });
    }

    const unavailable = incomplete
      .prepare("SELECT id FROM assets WHERE availability != 'available'")
      .all();
    expect(unavailable).toHaveLength(1);
    expect(
      complete.prepare("SELECT COUNT(*) AS n FROM assets WHERE availability = 'available'").get(),
    ).toEqual({ n: 5 });
    expect(
      incomplete.prepare("SELECT COUNT(*) AS n FROM assets WHERE availability = 'available'").get(),
    ).toEqual({ n: 4 });

    complete.close();
    incomplete.close();
  });

  it("carries only accounts the maintainer controls", () => {
    // The fixtures are public and permanent. A handle that is not one of these
    // means somebody else's content was committed by accident.
    const database = openDatabase(read("complete.cyd"));

    const handles = database
      .prepare("SELECT handle FROM profiles WHERE handle IS NOT NULL ORDER BY handle")
      .all()
      .map((row) => (row as { handle: string }).handle);

    expect(handles).toEqual([
      "aurorabyte-cyd.bsky.social",
      "glittertop-cyd.bsky.social",
    ]);
    database.close();
  });
});

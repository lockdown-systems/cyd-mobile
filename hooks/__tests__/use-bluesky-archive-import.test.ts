import { act, renderHook, waitFor } from "@testing-library/react-native";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createDiskBlueskyArchiveIntakeEnvironment,
  createNodeBlueskyArchiveRestoreEnvironment,
} from "@/testUtils/archiveEnvironments";
import {
  useBlueskyArchiveImport,
  type BlueskyArchiveImportRuntime,
} from "../use-bluesky-archive-import";

/**
 * The import as somebody drives it: pick a file, watch it work, decide.
 *
 * The runtime is the seam — the picker, intake, restore and merge all come in
 * from outside — so this runs the real archive services over the committed
 * fixture and only stands in for the phone. What it is here to hold down is
 * the ordering: an archive for an identity this device does not have is
 * restored without asking, one it does have waits for a decision, and walking
 * away in the middle leaves nothing behind and nothing on screen.
 */

const FIXTURE = path.join(
  __dirname,
  "../../testUtils/fixtures/bluesky-archive/complete.cyd",
);

jest.setTimeout(120_000);

type Harness = {
  root: string;
  runtime: BlueskyArchiveImportRuntime;
  stagingParent: string;
};

function harnessFor(): Harness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyd-import-hook-"));
  const stagingParent = path.join(root, "intake");
  const environment = createNodeBlueskyArchiveRestoreEnvironment({
    root: path.join(root, "app"),
  });
  let intakes = 0;

  return {
    root,
    stagingParent,
    runtime: {
      pickArchive: async () => ({ uri: `file://${FIXTURE}` }),
      intake: createDiskBlueskyArchiveIntakeEnvironment(stagingParent),
      restore: environment,
      merge: environment,
      newIntakeId: () => `intake-${(intakes += 1)}`,
    },
  };
}

/**
 * The hook opens the picked file itself, through the device reader. Under Node
 * there is no such reader, so the fixture is served from memory instead.
 */
jest.mock("@/services/archive-import", () => {
  const actual = jest.requireActual<
    typeof import("@/services/archive-import")
  >("@/services/archive-import");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fixtures = require("@/testUtils/archiveFixtures") as typeof import("@/testUtils/archiveFixtures");
  return {
    ...actual,
    openBlueskyArchiveByteReader: (uri: string) =>
      fixtures.createMemoryByteReader(
        new Uint8Array(nodeFs.readFileSync(uri.replace("file://", ""))),
      ),
  };
});

describe("importing a Cyd Bluesky archive from the menu", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  afterEach(() => {
    fs.rmSync(harness.root, { recursive: true, force: true });
  });

  it("restores an identity this device does not have, without asking", async () => {
    const { result } = renderHook(() =>
      useBlueskyArchiveImport({
        runtime: harness.runtime,
      }),
    );

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("done");
    });
    expect(result.current.state).toMatchObject({
      title: "Restored",
      handle: "glittertop-cyd.bsky.social",
      // A restored account has no Bluesky connection, so this is where one is
      // offered.
      offerSignIn: true,
    });
    // Staging is the import's working state, and the import is over.
    expect(fs.readdirSync(harness.stagingParent)).toEqual([]);
  });

  it("waits for a decision before merging into an account it already has", async () => {
    const { result } = renderHook(() =>
      useBlueskyArchiveImport({
        runtime: harness.runtime,
      }),
    );

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state.status).toBe("reviewing");

    await act(async () => {
      await result.current.confirmMerge();
    });

    expect(result.current.state).toMatchObject({
      status: "done",
      lines: ["This archive held nothing that account did not already have."],
    });
  });

  it("leaves nothing on screen or in staging when somebody walks away", async () => {
    const { result } = renderHook(() =>
      useBlueskyArchiveImport({
        runtime: harness.runtime,
      }),
    );

    await act(async () => {
      await result.current.start();
    });
    // A second import of the same identity stops to be reviewed, which is the
    // moment somebody is most likely to change their mind.
    const merging = act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.cancel();
    });
    await merging;

    expect(result.current.state.status).toBe("idle");
    expect(fs.readdirSync(harness.stagingParent)).toEqual([]);
  });

  /**
   * Getting your own data back into Cyd is not a premium feature (ADR 0015).
   *
   * This hook is driven with no `CydAccountProvider` above it, and
   * `useCydAccount` throws outside one — so an entitlement check anywhere
   * between the picker and the restored account would fail this rather than
   * quietly gate recovery on a subscription.
   */
  it("imports with no Cyd account signed in at all", async () => {
    const { result } = renderHook(() =>
      useBlueskyArchiveImport({
        runtime: harness.runtime,
      }),
    );

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("done");
    });
  });

  /**
   * Intake keeps a verified partial extraction so a killed import can be
   * resumed (ADR 0006), and nothing in Mobile offers to resume one — so
   * without this, every import the operating system interrupts leaves an
   * archive-sized directory behind until the app is uninstalled.
   */
  it("clears staging an earlier launch abandoned", async () => {
    fs.mkdirSync(path.join(harness.stagingParent, "abandoned-with-nothing"), {
      recursive: true,
    });
    const halfDone = path.join(harness.stagingParent, "abandoned-part-way");
    fs.mkdirSync(halfDone, { recursive: true });
    fs.writeFileSync(
      path.join(halfDone, "intake.json"),
      JSON.stringify({
        sourceUri: "file:///fixtures/complete.cyd",
        sourceBytes: 1,
        phase: "extracting",
        confirmedLargeArchive: false,
        totalBytes: 1,
        metadata: null,
        payloads: [],
        extracted: [],
        updatedAt: new Date().toISOString(),
      }),
    );

    const { result } = renderHook(() =>
      useBlueskyArchiveImport({
        runtime: harness.runtime,
      }),
    );

    await act(async () => {
      await result.current.start();
    });

    expect(fs.existsSync(halfDone)).toBe(false);
    expect(
      fs.readdirSync(harness.stagingParent).filter((name) =>
        name.startsWith("abandoned-"),
      ),
    ).toEqual([]);
  });
});

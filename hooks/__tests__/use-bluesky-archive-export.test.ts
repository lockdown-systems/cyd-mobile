import { act, renderHook, waitFor } from "@testing-library/react-native";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createNodeBlueskyArchiveExportEnvironment } from "@/scripts/dev/node-export-environment";
import {
  listResumableBlueskyArchiveExports,
  runBlueskyArchiveExport,
} from "@/services/archive-export";
import {
  ACCOUNT_DID,
  ACCOUNT_UUID,
  POST_URI,
  addMedia,
  createAccount,
  seedAccount,
  type Account,
} from "@/testUtils/blueskyExportAccount";

import {
  useBlueskyArchiveExport,
  type BlueskyArchiveExportRuntime,
} from "../use-bluesky-archive-export";

/**
 * The export as somebody drives it: agree to what it produces, watch it work,
 * receive the file.
 *
 * The runtime is the seam, so these run the real writer over a real seeded
 * Bluesky local account and stand in only for the phone: the controller that
 * pauses saving, and the share sheet that hands the archive over. What they
 * hold down is the order — nothing is written before the plaintext warning is
 * answered, nothing stays staged once the archive has been handed over, and an
 * export an earlier launch left half-finished is picked up rather than
 * restarted.
 */

type Harness = {
  root: string;
  stagingRoot: string;
  account: Account;
  runtime: BlueskyArchiveExportRuntime;
  shared: { location: string; fileName: string }[];
  saved: { location: string; fileName: string }[];
  /** Where the next folder picker lands, or null for somebody closing it. */
  pickedFolder: string | null;
  exportIds: string[];
  /** The staging directory each run was pointed at, in order. */
  runCalls: string[];
  /** Hold the next asset read, to park a run in the middle of hashing. */
  holdHashing: boolean;
  reachedHashing: Promise<void>;
  releaseHashing: () => void;
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function harnessFor(): Harness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyd-export-hook-"));
  const account = createAccount(root);
  seedAccount(account);
  addMedia(account, {
    contentCid: "bafyimage",
    postUri: POST_URI,
    position: 0,
    fileName: "bafyimage",
    contents: "image bytes",
  });

  const stagingRoot = path.join(root, "staging");
  const environment = createNodeBlueskyArchiveExportEnvironment({
    accountDirectory: account.directory,
    stagingRoot,
  });
  const shared: { location: string; fileName: string }[] = [];
  const saved: { location: string; fileName: string }[] = [];
  const exportIds: string[] = [];
  const runCalls: string[] = [];
  const reachedHashing = deferred();
  const releaseHashing = deferred();

  const harness: Harness = {
    root,
    stagingRoot,
    account,
    shared,
    saved,
    pickedFolder: "Documents",
    exportIds,
    runCalls,
    holdHashing: false,
    reachedHashing: reachedHashing.promise,
    releaseHashing: releaseHashing.resolve,
    runtime: {
      portableSettings: async () => ({ save_posts: true }),
      runExport: (request) => {
        runCalls.push(request.exportId);
        return runBlueskyArchiveExport(environment, {
          ...request,
          accountUuid: ACCOUNT_UUID,
          accountDid: ACCOUNT_DID,
          accountHandle: "alice.example",
        });
      },
      staging: environment,
      share: async (archive) => {
        shared.push(archive);
      },
      saveToDevice: async (archive) => {
        if (harness.pickedFolder === null) {
          return null;
        }
        saved.push(archive);
        return harness.pickedFolder;
      },
      newExportId: () => {
        const exportId = `export-${exportIds.length + 1}`;
        exportIds.push(exportId);
        return exportId;
      },
    },
  };

  // Hashing is where an export spends its time and where it asks whether it
  // has been cancelled, so parking a run inside one asset read is what lets a
  // test pin the interleaving instead of racing for it.
  const readFile = environment.readFile.bind(environment);
  environment.readFile = async (location, onBytes) => {
    if (harness.holdHashing) {
      reachedHashing.resolve();
      await releaseHashing.promise;
    }
    return readFile(location, onBytes);
  };

  return harness;
}

function stagingDirectories(harness: Harness): string[] {
  return fs.existsSync(harness.stagingRoot)
    ? fs.readdirSync(harness.stagingRoot)
    : [];
}

describe("exporting a Cyd Bluesky archive", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  afterEach(() => {
    harness.account.database.close();
    fs.rmSync(harness.root, { recursive: true, force: true });
  });

  function renderExport() {
    return renderHook(() =>
      useBlueskyArchiveExport({
        accountId: 1,
        accountUUID: ACCOUNT_UUID,
        runtime: harness.runtime,
      }),
    );
  }

  /**
   * A Cyd Bluesky archive is not encrypted, and the posts, chats and media in
   * it are as sensitive as whatever they were on Bluesky (ADR 0013). Somebody
   * about to put that file wherever a share sheet can reach is owed that
   * before it exists, not after.
   */
  it("says the archive is not encrypted before it writes one", async () => {
    const { result } = renderExport();

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toMatchObject({
      status: "warning",
      resuming: false,
    });
    expect(stagingDirectories(harness)).toEqual([]);
    expect(harness.shared).toEqual([]);
  });

  /** Build an archive and stop where somebody chooses what to do with it. */
  async function exportUntilReady(
    result: { current: ReturnType<typeof useBlueskyArchiveExport> },
  ): Promise<void> {
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.confirm();
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe("ready");
    });
  }

  /**
   * An archive nobody has been given yet is not a finished export.
   *
   * The file exists, but it is still only in staging, so the export is not
   * over and staging is not Cyd's to clear. Delivering is a separate act.
   */
  it("holds the archive until somebody says where it goes", async () => {
    const { result } = renderExport();

    await exportUntilReady(result);

    expect(result.current.state).toMatchObject({
      status: "ready",
      fileName: expect.stringMatching(/^cyd-bluesky-alice\.example-.*\.cyd$/),
    });
    expect(harness.shared).toEqual([]);
    expect(harness.saved).toEqual([]);
    expect(stagingDirectories(harness)).toHaveLength(1);
  });

  /**
   * Saving to the device is the delivery that needs nobody else.
   *
   * An Android share sheet is `ACTION_SEND` and lists only applications that
   * receive content, so without this the sole way out of Cyd is through a
   * cloud service — for a plaintext archive, and for a feature whose whole
   * point is that the data is yours (ADR 0013, ADR 0015).
   */
  it("saves the archive to this device, and keeps nothing staged once it has", async () => {
    const { result } = renderExport();

    await exportUntilReady(result);
    await act(async () => {
      await result.current.saveToDevice();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("done");
    });
    expect(harness.saved).toEqual([
      {
        location: expect.stringContaining("cyd-bluesky-alice.example-"),
        fileName: expect.stringMatching(/^cyd-bluesky-alice\.example-.*\.cyd$/),
      },
    ]);
    expect(harness.shared).toEqual([]);
    // An archive that has been delivered is not Cyd's to keep a second copy
    // of: staging held the whole thing, plus a copy of the account database.
    expect(stagingDirectories(harness)).toEqual([]);
  });

  /**
   * Closing the folder picker chose nothing, and the staged archive is the
   * only copy there is. Throwing it away over a dismissed dialog would mean
   * rebuilding the whole export to offer the same file again.
   */
  it("keeps the archive when somebody closes the folder picker", async () => {
    harness.pickedFolder = null;
    const { result } = renderExport();

    await exportUntilReady(result);
    await act(async () => {
      await result.current.saveToDevice();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("ready");
    });
    expect(harness.saved).toEqual([]);
    expect(stagingDirectories(harness)).toHaveLength(1);
  });

  it("hands the archive over, and keeps nothing staged once it has", async () => {
    const { result } = renderExport();

    await exportUntilReady(result);
    await act(async () => {
      await result.current.share();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("done");
    });
    expect(harness.shared).toEqual([
      {
        location: expect.stringContaining("cyd-bluesky-alice.example-"),
        fileName: expect.stringMatching(/^cyd-bluesky-alice\.example-.*\.cyd$/),
      },
    ]);
    expect(stagingDirectories(harness)).toEqual([]);
  });

  /**
   * Leave an export staged the way the operating system would: killed after
   * the snapshot and the hashing, before there is an archive.
   */
  async function interruptAnExport(exportId: string): Promise<void> {
    const broken = createNodeBlueskyArchiveExportEnvironment({
      accountDirectory: harness.account.directory,
      stagingRoot: harness.stagingRoot,
    });
    broken.createBlueskyInterchangeDatabase = () => {
      throw new Error("the operating system reclaimed Cyd");
    };
    await expect(
      runBlueskyArchiveExport(broken, {
        exportId,
        accountUuid: ACCOUNT_UUID,
        accountDid: ACCOUNT_DID,
        accountHandle: "alice.example",
        portableSettings: { save_posts: true },
      }),
    ).rejects.toThrow("reclaimed");
  }

  it("carries on the export an earlier launch left half-finished", async () => {
    await interruptAnExport("interrupted-export");

    const { result } = renderExport();
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toMatchObject({
      status: "warning",
      resuming: true,
    });

    await act(async () => {
      await result.current.confirm();
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe("ready");
    });
    await act(async () => {
      await result.current.saveToDevice();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("done");
    });
    // The staged export is the one that finished: no new id was taken out, so
    // the snapshot and the hashing an earlier launch paid for were not paid
    // for again.
    expect(harness.exportIds).toEqual([]);
    expect(harness.saved).toHaveLength(1);
    expect(stagingDirectories(harness)).toEqual([]);
  });

  /**
   * Declining to export right now is not asking Cyd to throw away an export an
   * earlier launch was interrupted part-way through. Backing out of a question
   * must leave the staged work exactly where it was.
   */
  it("keeps the staged export when somebody backs out of the warning", async () => {
    await interruptAnExport("interrupted-export");

    const { result } = renderExport();
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.dismiss();
    });

    expect(result.current.state.status).toBe("idle");
    expect(
      listResumableBlueskyArchiveExports(harness.runtime.staging).map(
        (staged) => staged.exportId,
      ),
    ).toEqual(["interrupted-export"]);
  });

  it("clears staging an abandoned export left, rather than keeping one per run", async () => {
    await interruptAnExport("older-export");
    await interruptAnExport("newer-export");

    const { result } = renderExport();
    await act(async () => {
      await result.current.start();
    });

    // An account exports one archive at a time. Anything behind the newest
    // checkpoint is a run nobody came back to, and each one is the size of the
    // account it copied.
    expect(
      listResumableBlueskyArchiveExports(harness.runtime.staging).map(
        (staged) => staged.exportId,
      ),
    ).toEqual(["newer-export"]);
  });

  /**
   * Walking away does not stop an export where it stands.
   *
   * `cancel` moves the generation on and returns, but the run in flight only
   * notices at its next boundary, and clearing its own staging is the last
   * thing it does on the way out. Starting again inside that window used to
   * hand the new export the dying one's directory — the same `exportId`, still
   * checkpointed on disk — which was then deleted out from under it part-way
   * through writing. What reached the person was a raw `unable to open
   * database file`, for having pressed a button twice.
   */
  it("does not start the next export in staging the last one is still clearing", async () => {
    addMedia(harness.account, {
      contentCid: "bafysecond",
      postUri: POST_URI,
      position: 1,
      fileName: "bafysecond",
      contents: "more image bytes",
    });
    const { result } = renderExport();
    harness.holdHashing = true;

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      const walkedAwayFrom = result.current.confirm();
      await harness.reachedHashing;

      // Somebody walks away while that run is hashing, and immediately asks
      // for another. The first run is still alive, and its checkpoint is
      // still on disk for the next export to find.
      result.current.cancel();
      harness.holdHashing = false;
      const restarted = (async () => {
        await result.current.start();
        await result.current.confirm();
      })();

      harness.releaseHashing();
      await Promise.all([walkedAwayFrom, restarted]);
    });

    // Two runs, never the same staging directory: whatever the first one
    // deleted on its way out, it was not the second one's.
    expect(harness.runCalls).toHaveLength(2);
    expect(new Set(harness.runCalls).size).toBe(2);
    await waitFor(() => {
      expect(result.current.state.status).toBe("ready");
    });
  });

  /**
   * Two taps landing before the screen catches up are one instruction.
   *
   * Nothing between the button and the writer used to say so: `confirm` read
   * the generation without moving it on, so both taps passed the same check
   * and started two runs over one staging directory, each snapshotting and
   * packaging into the other's files.
   */
  it("starts one export however many times the button is pressed", async () => {
    const { result } = renderExport();

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await Promise.all([result.current.confirm(), result.current.confirm()]);
    });

    expect(harness.runCalls).toHaveLength(1);
    await waitFor(() => {
      expect(result.current.state.status).toBe("ready");
    });
    expect(stagingDirectories(harness)).toHaveLength(1);
  });

  it("leaves nothing on screen or in staging when somebody walks away", async () => {
    const { result } = renderExport();
    await act(async () => {
      await result.current.start();
    });

    const exporting = act(async () => {
      await result.current.confirm();
    });
    act(() => {
      result.current.cancel();
    });
    await exporting;

    expect(result.current.state.status).toBe("idle");
    expect(stagingDirectories(harness)).toEqual([]);
    expect(harness.shared).toEqual([]);
  });
});

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
  exportIds: string[];
};

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
  const exportIds: string[] = [];

  return {
    root,
    stagingRoot,
    account,
    shared,
    exportIds,
    runtime: {
      portableSettings: async () => ({ save_posts: true }),
      runExport: (request) =>
        runBlueskyArchiveExport(environment, {
          ...request,
          accountUuid: ACCOUNT_UUID,
          accountDid: ACCOUNT_DID,
          accountHandle: "alice.example",
        }),
      staging: environment,
      share: async (archive) => {
        shared.push(archive);
      },
      newExportId: () => {
        const exportId = `export-${exportIds.length + 1}`;
        exportIds.push(exportId);
        return exportId;
      },
    },
  };
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

  it("hands the archive over, and keeps nothing staged once it has", async () => {
    const { result } = renderExport();

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.confirm();
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
    // An archive that has been handed over is not Cyd's to keep a second copy
    // of: staging held the whole thing, plus a copy of the account database.
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
      expect(result.current.state.status).toBe("done");
    });
    // The staged export is the one that finished: no new id was taken out, so
    // the snapshot and the hashing an earlier launch paid for were not paid
    // for again.
    expect(harness.exportIds).toEqual([]);
    expect(harness.shared).toHaveLength(1);
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

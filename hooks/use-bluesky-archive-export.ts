import * as Crypto from "expo-crypto";
import { Directory, File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useCallback, useRef, useState } from "react";

import { withBlueskyController } from "@/controllers";
import { getPortableBlueskySettings, listAccounts } from "@/database/accounts";
import {
  claimBlueskyArchiveExport,
  createBlueskyArchiveExportStaging,
  discardBlueskyArchiveExport,
  type BlueskyArchiveExportProgress,
  type BlueskyArchiveExportResult,
  type BlueskyArchiveExportStaging,
  type PortableSettings,
} from "@/services/archive-export";
import { BlueskyArchiveExportCancelled } from "@/services/archive-export";

/**
 * Writing a Cyd Bluesky archive, from asking to handing it over.
 *
 * Five things happen here that the writer itself has no opinion about.
 *
 * The first is the warning. A Cyd Bluesky archive is plaintext: Cyd protects
 * Bluesky connections in the operating system's own storage and leaves saved
 * posts, chats and media to the device's encryption (ADR 0013). Somebody about
 * to hand that file to whatever a share sheet reaches is owed that sentence
 * before the file exists, not once it is already in their downloads.
 *
 * The second is resuming. An export the operating system killed left a
 * checkpoint behind, and starting again picks it up rather than paying for the
 * snapshot and the hashing twice (ADR 0006).
 *
 * The third is delivery, which is also when staging stops being useful: the
 * archive lives in staging until it has been handed over, and is thrown away
 * immediately afterwards. Staging holds the archive *and* a copy of the
 * account database, so it is not a thing to leave lying around — but a
 * delivery that never happened leaves it alone, because the archive in there
 * is the only copy and trying again is meant to find it.
 *
 * Delivery is two things, not one, and Android is why. A share sheet is
 * `ACTION_SEND`, which enumerates applications that *receive* content — cloud
 * drives, mail, messengers — and never the device's own storage, because
 * saving to a folder is `ACTION_OPEN_DOCUMENT_TREE` and a different intent
 * entirely. Offering only the sheet would mean the one instruction this flow
 * gives ("put it somewhere you trust, like an encrypted drive") is the one
 * thing an Android user cannot do, and getting your data out of Cyd would
 * require handing it to somebody else first. So saving to the device is its
 * own affordance, on both platforms.
 *
 * The fourth is which account. Export is offered from the app-wide menu
 * beside import, so unlike everything else about an export there is no account
 * in hand when it starts. One Bluesky local account is not a question worth
 * asking, so it is not asked; more than one is.
 *
 * The fifth is nothing at all: no Cyd account, no entitlement check, no
 * network. Getting your own data out of Cyd is not a premium feature
 * (ADR 0015), and the absence of any such call here is the whole of that.
 */

/** A Bluesky local account an export can be written from. */
export type BlueskyArchiveExportAccount = {
  id: number;
  uuid: string;
  handle: string;
};

export type BlueskyArchiveExportState =
  | { status: "idle" }
  | {
      /** More than one Bluesky local account, so which one is a question. */
      status: "choosing";
      accounts: BlueskyArchiveExportAccount[];
    }
  | {
      status: "warning";
      /** The account this archive would be written from. */
      handle: string;
      /** Whether agreeing carries on an export rather than starting one. */
      resuming: boolean;
    }
  | {
      status: "working";
      message: string;
      /** Fraction done, or null while there is nothing meaningful to show. */
      fraction: number | null;
      cancellable: boolean;
    }
  | {
      /**
       * The archive exists, and is waiting to be put somewhere.
       *
       * It is still in staging, which is the only copy of it. Nothing here
       * decides where it goes: saving it to the device and handing it to
       * another application are both offered, and backing out of either
       * returns to this rather than throwing the archive away.
       */
      status: "ready";
      fileName: string;
      lines: string[];
    }
  | {
      status: "done";
      fileName: string;
      lines: string[];
    }
  | { status: "failed"; message: string };

/** The device capabilities an export needs, gathered so tests can stand in. */
export type BlueskyArchiveExportRuntime = {
  /** Every Bluesky local account on this device, in the order Cyd lists them. */
  listAccounts(): Promise<BlueskyArchiveExportAccount[]>;
  portableSettings(
    account: BlueskyArchiveExportAccount,
  ): Promise<PortableSettings>;
  runExport(request: {
    account: BlueskyArchiveExportAccount;
    exportId: string;
    portableSettings: PortableSettings;
    shouldCancel: () => boolean;
    onProgress: (progress: BlueskyArchiveExportProgress) => void;
  }): Promise<BlueskyArchiveExportResult>;
  staging: BlueskyArchiveExportStaging;
  share(archive: { location: string; fileName: string }): Promise<void>;
  /**
   * Copy the archive to a folder the person picks on this device.
   *
   * Resolves with the folder's name, or `null` if they backed out of the
   * picker without choosing one — which is not a failure, and must leave the
   * staged archive where it is.
   */
  saveToDevice(archive: {
    location: string;
    fileName: string;
  }): Promise<string | null>;
  newExportId(): string;
};

/**
 * Whether a file-picker rejection is somebody closing it rather than a fault.
 *
 * `expo-file-system` raises a coded exception for this, and the code is the
 * only thing separating "no folder chosen" from "the copy failed" — one
 * returns to the archive, the other is worth reporting.
 */
function isPickerCancelled(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : "";
  return (
    (typeof code === "string" && /cancel/i.test(code)) ||
    /cancel/i.test(message)
  );
}

function createDeviceRuntime(): BlueskyArchiveExportRuntime {
  return {
    listAccounts: async () =>
      (await listAccounts()).map((account) => ({
        id: account.id,
        uuid: account.uuid,
        handle: account.handle,
      })),
    portableSettings: (account) => getPortableBlueskySettings(account.id),
    runExport: ({ account, ...request }) =>
      withBlueskyController(account.id, account.uuid, (controller) =>
        controller.exportBlueskyArchive(request),
      ),
    staging: createBlueskyArchiveExportStaging(),
    share: async ({ location, fileName }) => {
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error(
          `This device cannot share files. The archive is at ${fileName}.`,
        );
      }
      await Sharing.shareAsync(location, {
        // The archive is a ZIP the contract names `.cyd`; saying so is what
        // lets somebody put it somewhere that keeps it whole.
        mimeType: "application/zip",
        dialogTitle: "Save your Cyd Bluesky archive",
        UTI: "public.zip-archive",
      });
    },
    saveToDevice: async ({ location }) => {
      let folder: Directory;
      try {
        folder = await Directory.pickDirectoryAsync();
      } catch (error) {
        if (isPickerCancelled(error)) {
          return null;
        }
        throw error;
      }
      // The copy is native and streamed, so an archive of preserved video
      // costs the same here as an archive of one thumbnail. Reading it into
      // JavaScript to write it back out would not survive a real account.
      await new File(location).copy(folder);
      return folder.name;
    },
    newExportId: () => Crypto.randomUUID(),
  };
}

const PHASE_MESSAGES: Record<BlueskyArchiveExportProgress["phase"], string> = {
  staging: "Pausing this account's work and copying its data…",
  hashing: "Checking the preserved media…",
  translating: "Writing the archive's database…",
  packaging: "Packaging the archive…",
  done: "Finishing…",
};

/** How far along a phase that can say is, between 0 and 1. */
function fractionOf(progress: BlueskyArchiveExportProgress): number | null {
  if (progress.phase === "hashing" && progress.totalAssets > 0) {
    return progress.hashedAssets / progress.totalAssets;
  }
  if (progress.phase === "packaging" && progress.totalPayloads > 0) {
    return progress.packagedPayloads / progress.totalPayloads;
  }
  return null;
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * What the archive turned out to contain, including what it could not.
 *
 * An archive short of a file is still worth having, and saying so is the
 * difference between an honest incomplete Cyd Bluesky archive and one that
 * quietly claims to be complete (#91, ADR 0010). The two ways a file can be
 * absent stay apart for the same reason: one is media Cyd never finished
 * preserving, and the other is media Cyd had and could not read at the moment
 * it packaged the archive.
 */
function describeResult(result: BlueskyArchiveExportResult): string[] {
  const lines = [
    `${plural(result.assets.available, "media file")} packaged, ` +
      `${(result.byteLength / (1024 * 1024)).toFixed(1)} MB in total.`,
  ];
  if (result.assets.missing > 0) {
    lines.push(
      `${plural(result.assets.missing, "file")} Cyd never finished saving ` +
        `${result.assets.missing === 1 ? "is" : "are"} named in the archive ` +
        `as missing.`,
    );
  }
  if (result.assets.unavailable > 0) {
    lines.push(
      `${plural(result.assets.unavailable, "file")} could not be read while ` +
        `the archive was being written, and ${
          result.assets.unavailable === 1 ? "is" : "are"
        } named in it as unavailable.`,
    );
  }
  if (result.metadata.completeness === "incomplete") {
    lines.push("Everything else is in there, which is most of it.");
  }
  return lines;
}

function messageFor(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Cyd could not export that account.";
}

export function useBlueskyArchiveExport(
  options: { runtime?: BlueskyArchiveExportRuntime } = {},
) {
  const { runtime } = options;
  const [state, setState] = useState<BlueskyArchiveExportState>({
    status: "idle",
  });
  const runtimeRef = useRef<BlueskyArchiveExportRuntime | null>(
    runtime ?? null,
  );
  /** The Bluesky local account this export is of, once one has been chosen. */
  const accountRef = useRef<BlueskyArchiveExportAccount | null>(null);
  const exportIdRef = useRef<string | null>(null);
  /** The finished archive, held while somebody decides where to put it. */
  const resultRef = useRef<BlueskyArchiveExportResult | null>(null);
  /**
   * Which export the person is actually in.
   *
   * Every step is asynchronous and none can be called back: hashing a
   * gigabyte of video runs to completion whatever happens on screen. Walking
   * away moves the count on, and a step that finishes afterwards finds it has
   * been left behind and says nothing.
   */
  const generationRef = useRef(0);
  /**
   * Whatever is touching staging right now, if anything.
   *
   * One export owns one staging directory, and owning it outlasts the screen:
   * an export somebody walked away from is still hashing, and still has its
   * own directory to clear, well after `cancel` has returned. Two things in
   * there at once is two snapshots, two interchange databases, and two writers
   * packaging into the same file.
   */
  const runningRef = useRef<Promise<void> | null>(null);

  const exportRuntime = useCallback((): BlueskyArchiveExportRuntime => {
    if (!runtimeRef.current) {
      runtimeRef.current = createDeviceRuntime();
    }
    return runtimeRef.current;
  }, []);

  const settle = useCallback(
    (generation: number, next: BlueskyArchiveExportState): boolean => {
      if (generationRef.current !== generation) {
        return false;
      }
      setState(next);
      return true;
    },
    [],
  );

  /**
   * Do `work` as the only thing touching staging, or do nothing at all.
   *
   * Two taps landing before the screen has caught up are one instruction, not
   * two exports. Nothing else enforces that: every step here is asynchronous,
   * so both taps would otherwise pass the same checks and start two runs over
   * one directory.
   */
  const exclusively = useCallback(
    async (work: () => Promise<void>): Promise<void> => {
      if (runningRef.current) {
        return;
      }
      const running = work();
      // What is held is *when* the run lets go of staging, never how it went:
      // reporting a failure is `work`'s own job, and anything waiting here is
      // waiting for the directory, not for the outcome.
      const settled = running.then(
        () => undefined,
        () => undefined,
      );
      runningRef.current = settled;
      void settled.then(() => {
        if (runningRef.current === settled) {
          runningRef.current = null;
        }
      });
      await running;
    },
    [],
  );

  /**
   * Take up an account, and warn before anything is written.
   *
   * Claiming is what makes resuming possible, and it is per account: staging
   * an earlier launch left behind belongs to the account it was an export of,
   * and is picked up only when that account is the one being exported again.
   */
  const openWarningFor = useCallback(
    async (
      account: BlueskyArchiveExportAccount,
      generation: number,
    ): Promise<void> => {
      // An export somebody walked away from clears its staging on the way out,
      // and only reaches the boundary where it notices at its own pace. What
      // is still on disk until then is a checkpoint that claiming would hand
      // straight back — the dying run's directory, deleted out from under
      // whatever resumed into it.
      const leaving = runningRef.current;
      if (leaving) {
        await leaving;
        if (generationRef.current !== generation) {
          return;
        }
      }
      accountRef.current = account;
      const staged = claimBlueskyArchiveExport(
        exportRuntime().staging,
        account.uuid,
      );
      exportIdRef.current = staged?.exportId ?? null;
      settle(generation, {
        status: "warning",
        handle: account.handle,
        resuming: staged !== null,
      });
    },
    [exportRuntime, settle],
  );

  /**
   * Ask before anything is written, and say what will be written.
   *
   * Export is reached from the app-wide menu, so which account is a question
   * this has to answer before any of the rest applies. It is only put to the
   * person when it is a real question: with one Bluesky local account there is
   * nothing to choose, and with none there is nothing to export.
   */
  const start = useCallback(async (): Promise<void> => {
    const generation = (generationRef.current += 1);
    try {
      const accounts = await exportRuntime().listAccounts();
      if (generationRef.current !== generation) {
        return;
      }
      if (accounts.length === 0) {
        settle(generation, {
          status: "failed",
          message:
            "There is no Bluesky account on this device yet. Add one and save its data first.",
        });
        return;
      }
      if (accounts.length > 1) {
        settle(generation, { status: "choosing", accounts });
        return;
      }
      await openWarningFor(accounts[0], generation);
    } catch (error) {
      settle(generation, { status: "failed", message: messageFor(error) });
    }
  }, [exportRuntime, openWarningFor, settle]);

  /** Answer the which-account question. */
  const choose = useCallback(
    async (account: BlueskyArchiveExportAccount): Promise<void> => {
      const generation = generationRef.current;
      try {
        await openWarningFor(account, generation);
      } catch (error) {
        settle(generation, { status: "failed", message: messageFor(error) });
      }
    },
    [openWarningFor, settle],
  );

  const confirm = useCallback(
    (): Promise<void> =>
      exclusively(async () => {
        const generation = generationRef.current;
        const account = accountRef.current;
        if (!account) {
          return;
        }
        const { runExport, portableSettings, staging, newExportId } =
          exportRuntime();
        const exportId = exportIdRef.current ?? newExportId();
        exportIdRef.current = exportId;

        settle(generation, {
          status: "working",
          message: PHASE_MESSAGES.staging,
          fraction: null,
          cancellable: true,
        });

        try {
          const result = await runExport({
            account,
            exportId,
            portableSettings: await portableSettings(account),
            shouldCancel: () => generationRef.current !== generation,
            onProgress: (progress) =>
              settle(generation, {
                status: "working",
                message: PHASE_MESSAGES[progress.phase],
                fraction: fractionOf(progress),
                cancellable: progress.phase !== "done",
              }),
          });

          if (generationRef.current !== generation) {
            // Somebody walked away while the last of the archive was written. The
            // export finished anyway, so its staging is this run's to clear.
            discardBlueskyArchiveExport(staging, exportId);
            return;
          }

          // The archive exists and is staged; where it goes is the next decision,
          // and it is not this function's to make. Staging is not cleared here
          // precisely because nothing has been delivered yet.
          resultRef.current = result;
          settle(generation, {
            status: "ready",
            fileName: result.fileName,
            lines: describeResult(result),
          });
        } catch (error) {
          if (error instanceof BlueskyArchiveExportCancelled) {
            exportIdRef.current = null;
            settle(generation, { status: "idle" });
            return;
          }
          settle(generation, { status: "failed", message: messageFor(error) });
        }
      }),
    [exclusively, exportRuntime, settle],
  );

  /**
   * Put the finished archive somewhere, and stop staging it once it is there.
   *
   * Both deliveries end the same way, so they share this: the archive leaves
   * Cyd, and only then is the staged copy — archive plus a copy of the account
   * database — thrown away. A delivery somebody backed out of returns to the
   * archive instead, because what is in staging is still the only copy.
   */
  const deliver = useCallback(
    async (
      hand: (archive: {
        location: string;
        fileName: string;
      }) => Promise<string | null>,
    ): Promise<void> =>
      exclusively(async () => {
        const generation = generationRef.current;
        const result = resultRef.current;
        const exportId = exportIdRef.current;
        if (!result || !exportId) {
          return;
        }
        const { staging } = exportRuntime();
        const archive = {
          location: result.location,
          fileName: result.fileName,
        };

        settle(generation, {
          status: "working",
          message: "Handing the archive over…",
          fraction: null,
          cancellable: false,
        });
        try {
          const delivered = await hand(archive);
          if (delivered === null) {
            settle(generation, {
              status: "ready",
              fileName: result.fileName,
              lines: describeResult(result),
            });
            return;
          }
          discardBlueskyArchiveExport(staging, exportId);
          exportIdRef.current = null;
          resultRef.current = null;
          settle(generation, {
            status: "done",
            fileName: result.fileName,
            lines: [...describeResult(result), delivered],
          });
        } catch (error) {
          settle(generation, { status: "failed", message: messageFor(error) });
        }
      }),
    [exclusively, exportRuntime, settle],
  );

  /** Copy the archive into a folder on this device. */
  const saveToDevice = useCallback(
    (): Promise<void> =>
      deliver(async (archive) => {
        const folder = await exportRuntime().saveToDevice(archive);
        return folder === null ? null : `Saved to ${folder}.`;
      }),
    [deliver, exportRuntime],
  );

  /**
   * Hand the archive to another application.
   *
   * Unlike saving, this cannot tell whether anything was actually kept: a
   * share sheet reports that it closed, not what the application behind it
   * did. Staging is cleared on the strength of that, because the alternative
   * is keeping a copy of every account that ever opened one.
   */
  const share = useCallback(
    (): Promise<void> =>
      deliver(async (archive) => {
        await exportRuntime().share(archive);
        return "Handed to the share sheet.";
      }),
    [deliver, exportRuntime],
  );

  /**
   * Walk away from an export that is running.
   *
   * Moving the generation on is what makes this final: a hashing pass already
   * in flight cannot be stopped mid-file, but it asks between files, and what
   * it reports afterwards is reported to nobody. Clearing the staging is the
   * export's own job on the way out — doing it from here would be deleting a
   * directory something is still writing to, and it would be written again.
   */
  const cancel = useCallback((): void => {
    generationRef.current += 1;
    accountRef.current = null;
    exportIdRef.current = null;
    resultRef.current = null;
    setState({ status: "idle" });
  }, []);

  /**
   * Close what is on screen, leaving anything staged where it is.
   *
   * This is backing out of the warning, and closing a report. Neither is
   * cancelling an export: somebody who declines to export right now has not
   * asked Cyd to throw away the export an earlier launch was interrupted
   * part-way through, and the next attempt is what picks that up.
   */
  const dismiss = useCallback((): void => {
    generationRef.current += 1;
    accountRef.current = null;
    resultRef.current = null;
    setState({ status: "idle" });
  }, []);

  return {
    state,
    start,
    choose,
    confirm,
    saveToDevice,
    share,
    cancel,
    dismiss,
  };
}

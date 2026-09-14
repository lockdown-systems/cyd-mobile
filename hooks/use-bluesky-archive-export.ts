import * as Crypto from "expo-crypto";
import { Directory, File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useCallback, useRef, useState } from "react";

import { withBlueskyController } from "@/controllers";
import { getPortableBlueskySettings } from "@/database/accounts";
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
 * Four things happen here that the writer itself has no opinion about.
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
 * The fourth is nothing at all: no Cyd account, no entitlement check, no
 * network. Getting your own data out of Cyd is not a premium feature
 * (ADR 0015), and the absence of any such call here is the whole of that.
 */

export type BlueskyArchiveExportState =
  | { status: "idle" }
  | {
      status: "warning";
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
  portableSettings(): Promise<PortableSettings>;
  runExport(request: {
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
    (typeof code === "string" && /cancel/i.test(code)) || /cancel/i.test(message)
  );
}

function createDeviceRuntime(
  accountId: number,
  accountUUID: string,
): BlueskyArchiveExportRuntime {
  return {
    portableSettings: () => getPortableBlueskySettings(accountId),
    runExport: (request) =>
      withBlueskyController(accountId, accountUUID, (controller) =>
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

const PHASE_MESSAGES: Record<
  BlueskyArchiveExportProgress["phase"],
  string
> = {
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

export function useBlueskyArchiveExport(options: {
  accountId: number;
  accountUUID: string;
  runtime?: BlueskyArchiveExportRuntime;
}) {
  const { accountId, accountUUID, runtime } = options;
  const [state, setState] = useState<BlueskyArchiveExportState>({
    status: "idle",
  });
  const runtimeRef = useRef<BlueskyArchiveExportRuntime | null>(runtime ?? null);
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

  const exportRuntime = useCallback((): BlueskyArchiveExportRuntime => {
    if (!runtimeRef.current) {
      runtimeRef.current = createDeviceRuntime(accountId, accountUUID);
    }
    return runtimeRef.current;
  }, [accountId, accountUUID]);

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

  /** Ask before anything is written, and say what will be written. */
  const start = useCallback(async (): Promise<void> => {
    const generation = (generationRef.current += 1);
    try {
      const staged = claimBlueskyArchiveExport(
        exportRuntime().staging,
        accountUUID,
      );
      exportIdRef.current = staged?.exportId ?? null;
      settle(generation, {
        status: "warning",
        resuming: staged !== null,
      });
    } catch (error) {
      settle(generation, { status: "failed", message: messageFor(error) });
    }
  }, [accountUUID, exportRuntime, settle]);

  const confirm = useCallback(async (): Promise<void> => {
    const generation = generationRef.current;
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
        exportId,
        portableSettings: await portableSettings(),
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
  }, [exportRuntime, settle]);

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
    ): Promise<void> => {
      const generation = generationRef.current;
      const result = resultRef.current;
      const exportId = exportIdRef.current;
      if (!result || !exportId) {
        return;
      }
      const { staging } = exportRuntime();
      const archive = { location: result.location, fileName: result.fileName };

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
    },
    [exportRuntime, settle],
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
    resultRef.current = null;
    setState({ status: "idle" });
  }, []);

  return { state, start, confirm, saveToDevice, share, cancel, dismiss };
}

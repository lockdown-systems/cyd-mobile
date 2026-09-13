import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useRef, useState } from "react";

import {
  cancelBlueskyArchiveIntake,
  createBlueskyArchiveIntakeEnvironment,
  openBlueskyArchiveByteReader,
  runBlueskyArchiveIntake,
  type BlueskyArchiveIntakeEnvironment,
  type PreparedBlueskyArchive,
} from "@/services/archive-import";
import {
  chooseBlueskyArchiveImportDestination,
  commitBlueskyArchiveMerge,
  createBlueskyArchiveMergeEnvironment,
  previewBlueskyArchiveMerge,
  previewDuplicateReconciliation,
  reconcileDuplicateBlueskyAccounts,
  totalMergeChanges,
  type BlueskyArchiveMergeEnvironment,
  type BlueskyArchiveMergePreview,
  type BlueskyArchiveMergeResult,
  type DuplicateReconciliationPreview,
} from "@/services/archive-merge";
import {
  NO_SCHEDULED_REMINDERS,
  type ScheduledReminderSync,
} from "@/services/scheduled-reminder-sync";
import {
  createBlueskyArchiveRestoreEnvironment,
  restoreBlueskyArchiveAccount,
  type BlueskyArchiveRestoreEnvironment,
  type LocalAccountIdentity,
} from "@/services/archive-restore";
import { emitLocalAccountsChanged } from "@/services/account-events";

/**
 * Importing a Cyd Bluesky archive, from the menu to the account.
 *
 * This is the entry point #93 removed and #97 owns again, and it is one thing
 * rather than two because routing a picked archive and merging one are the
 * same decision: intake reports the Bluesky identity's DID, and whether the
 * import creates a Bluesky local account or merges into one follows from
 * whether this installation already holds it.
 *
 * What is deliberately *not* here is the behaviour #91 ruled out. Nothing
 * reads the picked file's name, and nothing is unpacked before the archive has
 * been inspected — both belong to intake now, which verifies every payload
 * against the manifest before it lands in staging.
 *
 * The person is asked before anything irreversible: to confirm an unusually
 * large archive, to look at records a merge would bring back, and to choose
 * which Bluesky local account survives when this installation holds one
 * identity twice. Cancelling at any of those points takes the staging with it.
 */

export type BlueskyArchiveImportState =
  | { status: "idle" }
  | {
      status: "working";
      message: string;
      /** Fraction done, or null while there is nothing meaningful to show. */
      fraction: number | null;
      cancellable: boolean;
    }
  | { status: "needs-confirmation"; message: string }
  | {
      status: "reconciling";
      message: string;
      preview: DuplicateReconciliationPreview;
    }
  | {
      status: "reviewing";
      preview: BlueskyArchiveMergePreview;
      handle: string;
    }
  | {
      status: "done";
      title: string;
      /**
       * The account the import ended in, kept apart from the title so it can
       * be shown on its own line: a handle is one unbroken token, and a title
       * that has to wrap around one breaks it wherever it runs out of room.
       */
      handle: string;
      lines: string[];
      /**
       * Whether to offer a Bluesky connection from here.
       *
       * A restored Bluesky local account has none — a Cyd Bluesky archive
       * never carries one — and this is the moment somebody is thinking about
       * that account, so it is the moment worth asking. A merge leaves the
       * account's existing connection alone and has nothing to offer.
       */
      offerSignIn: boolean;
    }
  | { status: "failed"; message: string };

/** The device capabilities an import needs, gathered so tests can stand in. */
export type BlueskyArchiveImportRuntime = {
  pickArchive(): Promise<{ uri: string } | null>;
  intake: BlueskyArchiveIntakeEnvironment;
  restore: BlueskyArchiveRestoreEnvironment;
  merge: BlueskyArchiveMergeEnvironment;
  newIntakeId(): string;
};

function createDeviceRuntime(): BlueskyArchiveImportRuntime {
  return {
    pickArchive: async () => {
      // No filename validation, and no type filter narrow enough to hide a
      // real archive: what the file *is* is settled by reading it (#91).
      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) {
        return null;
      }
      return { uri: picked.assets[0].uri };
    },
    intake: createBlueskyArchiveIntakeEnvironment(),
    restore: createBlueskyArchiveRestoreEnvironment(),
    merge: createBlueskyArchiveMergeEnvironment(),
    newIntakeId: () => Crypto.randomUUID(),
  };
}

type Session = {
  intakeId: string;
  sourceUri: string;
  confirmedLargeArchive: boolean;
  /** Set once intake ends *prepared*, so a later step can reach the staging. */
  prepared: PreparedBlueskyArchive | null;
};

function messageFor(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Cyd could not import that archive.";
}

/**
 * Tell the server which Bluesky local account its reminders belong to now.
 *
 * A reconciliation is finished either way: reminders are a convenience, and an
 * offline phone must not be told its accounts failed to merge. The worst case
 * is a reminder that opens an account which now holds more than it did.
 */
async function syncReminders(
  reminders: ScheduledReminderSync,
  reconciled: { survivingUuid: string; removedUuids: string[] },
): Promise<void> {
  try {
    for (const uuid of reconciled.removedUuids) {
      await reminders.retire(uuid);
    }
    await reminders.resync(reconciled.survivingUuid);
  } catch (error) {
    console.warn("[archive-import] could not update reminders", error);
  }
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * What a merge did, counting every kind of change it made.
 *
 * Only what actually happened is mentioned: a merge that recovered one image
 * and nothing else should say so, rather than reporting that no records came
 * back and none gained anything — which is true, and tells somebody their
 * import did nothing.
 */
function describeMergeResult(result: BlueskyArchiveMergeResult): string[] {
  if (result.written === 0) {
    return ["This archive held nothing that account did not already have."];
  }

  const totals = totalMergeChanges(result.summary);
  const files = totals.files.added + totals.files.updated;
  const lines: string[] = [];
  if (totals.records.added > 0) {
    lines.push(`${plural(totals.records.added, "record")} came back.`);
  }
  if (totals.records.updated > 0) {
    lines.push(`${plural(totals.records.updated, "record")} gained something.`);
  }
  if (files > 0) {
    lines.push(`${plural(files, "media file")} restored.`);
  }
  if (lines.length === 0) {
    lines.push("Some records gained details this account was missing.");
  }
  lines.push(
    "Your settings, schedule and Bluesky connection were left as they were.",
  );
  return lines;
}

export function useBlueskyArchiveImport(
  options: {
    runtime?: BlueskyArchiveImportRuntime;
    reminders?: ScheduledReminderSync;
  } = {},
) {
  const { runtime, reminders } = options;
  const [state, setState] = useState<BlueskyArchiveImportState>({
    status: "idle",
  });
  const runtimeRef = useRef<BlueskyArchiveImportRuntime | null>(
    runtime ?? null,
  );
  const sessionRef = useRef<Session | null>(null);
  /**
   * Which import the person is actually in.
   *
   * Every step of an import is asynchronous and none of them can be called
   * back: reading an archive off the device, or working out what a merge would
   * do, runs to completion whatever happens on screen. Walking away moves the
   * count on, and a step that finishes afterwards finds it has been left
   * behind and says nothing — otherwise a cancelled import would reappear,
   * pointing at staging it no longer has.
   */
  const generationRef = useRef(0);

  const settle = useCallback(
    (generation: number, next: BlueskyArchiveImportState): boolean => {
      if (generationRef.current !== generation) {
        return false;
      }
      setState(next);
      return true;
    },
    [],
  );

  const importRuntime = useCallback((): BlueskyArchiveImportRuntime => {
    if (!runtimeRef.current) {
      runtimeRef.current = createDeviceRuntime();
    }
    return runtimeRef.current;
  }, []);

  /** Abandon an import and take its staging with it (AC: nothing left behind). */
  const discardStaging = useCallback(() => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    try {
      cancelBlueskyArchiveIntake(importRuntime().intake, session.intakeId);
    } catch (error) {
      console.warn("[archive-import] could not clear staging", error);
    }
    sessionRef.current = null;
  }, [importRuntime]);

  const runRestore = useCallback(
    async (
      prepared: PreparedBlueskyArchive,
      environment: BlueskyArchiveRestoreEnvironment,
      generation: number,
    ): Promise<void> => {
      settle(generation, {
        status: "working",
        message: "Restoring the account…",
        fraction: null,
        cancellable: false,
      });

      const result = await restoreBlueskyArchiveAccount(environment, {
        archive: {
          intakeId: prepared.intakeId,
          stagingRoot: prepared.stagingRoot,
        },
        onProgress: (progress) =>
          settle(generation, {
            status: "working",
            message: "Restoring the account…",
            fraction:
              progress.totalAssets > 0
                ? progress.restoredAssets / progress.totalAssets
                : null,
            cancellable: false,
          }),
      });

      sessionRef.current = null;
      emitLocalAccountsChanged();
      settle(generation, {
        status: "done",
        title: "Restored",
        handle: result.handle,
        offerSignIn: true,
        lines: [
          `${plural(result.counts.posts, "post")}, ${plural(result.counts.likes, "like")}, ${plural(result.counts.chats, "chat")}.`,
          `${plural(result.assets.restored, "file")} restored${result.assets.missing > 0 ? `, ${result.assets.missing} missing` : ""}.`,
          "You can browse all of it now. Cyd needs a Bluesky connection before it can save or delete anything for this account.",
          ...(result.uuidRemapping ? [result.uuidRemapping.reason] : []),
        ],
      });
    },
    [settle],
  );

  const openMergePreview = useCallback(
    async (
      prepared: PreparedBlueskyArchive,
      environment: BlueskyArchiveMergeEnvironment,
      account: LocalAccountIdentity,
      generation: number,
    ): Promise<void> => {
      settle(generation, {
        status: "working",
        message: "Working out what this archive would add…",
        fraction: null,
        cancellable: true,
      });

      const preview = await previewBlueskyArchiveMerge(environment, {
        archive: {
          intakeId: prepared.intakeId,
          stagingRoot: prepared.stagingRoot,
        },
        account,
      });

      settle(generation, {
        status: "reviewing",
        preview,
        handle: account.handle ?? preview.accountDid,
      });
    },
    [settle],
  );

  /** Where this archive goes, decided by the DID intake reported. */
  const route = useCallback(
    async (
      prepared: PreparedBlueskyArchive,
      ports: Pick<BlueskyArchiveImportRuntime, "restore" | "merge">,
      generation: number,
    ): Promise<void> => {
      const identities =
        await ports.merge.listLocalAccountIdentities();
      const destination = chooseBlueskyArchiveImportDestination(
        prepared.metadata.accountDid,
        identities,
      );

      if (destination.kind === "restore") {
        await runRestore(prepared, ports.restore, generation);
        return;
      }
      if (destination.kind === "merge") {
        await openMergePreview(
          prepared,
          ports.merge,
          destination.account,
          generation,
        );
        return;
      }

      const reconciliation = await previewDuplicateReconciliation(
        ports.merge,
        { did: destination.did, accounts: identities },
      );
      settle(generation, {
        status: "reconciling",
        message:
          "This device has more than one Bluesky account for the identity in this archive. Choose which one to keep before importing.",
        preview: reconciliation,
      });
    },
    [openMergePreview, runRestore, settle],
  );

  const run = useCallback(
    async (session: Session, generation: number): Promise<void> => {
      const { intake, restore, merge } = importRuntime();
      sessionRef.current = session;

      settle(generation, {
        status: "working",
        message: "Reading the archive…",
        fraction: null,
        cancellable: true,
      });

      const outcome = await runBlueskyArchiveIntake(intake, {
        intakeId: session.intakeId,
        sourceUri: session.sourceUri,
        openReader: async () =>
          openBlueskyArchiveByteReader(session.sourceUri),
        confirmLargeArchive: session.confirmedLargeArchive,
        // Intake asks between payloads, so walking away stops the extraction
        // itself rather than only what it reports.
        shouldCancel: () => generationRef.current !== generation,
        onProgress: (progress) =>
          settle(generation, {
            status: "working",
            message: "Reading the archive…",
            fraction:
              progress.totalBytes > 0
                ? progress.preparedBytes / progress.totalBytes
                : null,
            cancellable: true,
          }),
      });

      if (outcome.status === "cancelled") {
        sessionRef.current = null;
        settle(generation, { status: "idle" });
        return;
      }
      if (outcome.status === "rejected") {
        // Intake clears staging for an archive it blames, and keeps it for a
        // failure it blames the device for, so that freeing space and trying
        // again resumes. Nothing offers to resume from here, so a rejection
        // ends the import and takes any staging with it either way.
        discardStaging();
        settle(generation, { status: "failed", message: outcome.message });
        return;
      }
      if (outcome.status === "needs-confirmation") {
        settle(generation, {
          status: "needs-confirmation",
          message: outcome.message,
        });
        return;
      }

      if (generationRef.current !== generation) {
        // Somebody walked away while the last of the archive was being read.
        // Intake finished anyway, so the staging it prepared is this import's
        // to clear.
        discardStaging();
        return;
      }

      sessionRef.current = { ...session, prepared: outcome };
      await route(outcome, { restore, merge }, generation);
    },
    [discardStaging, importRuntime, route, settle],
  );

  /** Pick the archive and take it as far as it can go without a decision. */
  const start = useCallback(async (): Promise<void> => {
    const generation = (generationRef.current += 1);
    try {
      const picked = await importRuntime().pickArchive();
      if (!picked) {
        return;
      }
      await run(
        {
          intakeId: importRuntime().newIntakeId(),
          sourceUri: picked.uri,
          confirmedLargeArchive: false,
          prepared: null,
        },
        generation,
      );
    } catch (error) {
      discardStaging();
      settle(generation, { status: "failed", message: messageFor(error) });
    }
  }, [discardStaging, importRuntime, run, settle]);

  const confirmLargeArchive = useCallback(async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    // The same import, carried on: the generation does not move, so cancelling
    // still reaches everything this starts.
    const generation = generationRef.current;
    try {
      await run({ ...session, confirmedLargeArchive: true }, generation);
    } catch (error) {
      discardStaging();
      settle(generation, { status: "failed", message: messageFor(error) });
    }
  }, [discardStaging, run, settle]);

  /** Commit a merge the person has looked at. */
  const confirmMerge = useCallback(async (): Promise<void> => {
    if (state.status !== "reviewing") {
      return;
    }
    const { preview, handle } = state;
    const generation = generationRef.current;
    try {
      settle(generation, {
        status: "working",
        message: "Merging the archive…",
        fraction: null,
        cancellable: false,
      });
      const result = await commitBlueskyArchiveMerge(
        importRuntime().merge,
        preview,
        {
          onProgress: (progress) =>
            settle(generation, {
              status: "working",
              message: "Merging the archive…",
              fraction:
                progress.totalAssets > 0
                  ? progress.mergedAssets / progress.totalAssets
                  : null,
              cancellable: false,
            }),
        },
      );

      sessionRef.current = null;
      emitLocalAccountsChanged();
      settle(generation, {
        status: "done",
        title: "Merged into",
        handle,
        offerSignIn: false,
        lines: describeMergeResult(result),
      });
    } catch (error) {
      discardStaging();
      settle(generation, { status: "failed", message: messageFor(error) });
    }
  }, [discardStaging, importRuntime, settle, state]);

  /**
   * Keep one of the duplicate Bluesky local accounts, then carry on importing.
   *
   * The reconciliation runs first because the import has nowhere to land until
   * the identity is held once (ADR 0011).
   */
  const keepAccount = useCallback(
    async (choice: {
      survivingUuid: string;
      settingsFromUuid: string;
    }): Promise<void> => {
      const session = sessionRef.current;
      if (state.status !== "reconciling" || !session?.prepared) {
        return;
      }
      const { prepared } = session;
      const { merge } = importRuntime();
      const generation = generationRef.current;
      try {
        settle(generation, {
          status: "working",
          message: "Merging the duplicate accounts…",
          fraction: null,
          cancellable: false,
        });
        const reconciled = await reconcileDuplicateBlueskyAccounts(merge, {
          did: state.preview.did,
          accounts: await merge.listLocalAccountIdentities(),
          survivingUuid: choice.survivingUuid,
          settingsFromUuid: choice.settingsFromUuid,
        });
        emitLocalAccountsChanged();
        await syncReminders(reminders ?? NO_SCHEDULED_REMINDERS, reconciled);

        const survivor = (await merge.listLocalAccountIdentities()).find(
          (account) => account.uuid === choice.survivingUuid,
        );
        if (!survivor) {
          throw new Error(
            "Cyd could not find the Bluesky account it just kept.",
          );
        }
        await openMergePreview(prepared, merge, survivor, generation);
      } catch (error) {
        discardStaging();
        settle(generation, { status: "failed", message: messageFor(error) });
      }
    },
    [discardStaging, importRuntime, openMergePreview, reminders, settle, state],
  );

  /**
   * Walk away: nothing has been written, and nothing stays staged.
   *
   * Moving the generation on is what makes this final. A step already in
   * flight — an archive being read, a merge being worked out — cannot be
   * stopped mid-call, but it can be made to report to nobody.
   */
  const cancel = useCallback((): void => {
    generationRef.current += 1;
    discardStaging();
    setState({ status: "idle" });
  }, [discardStaging]);

  const dismiss = useCallback((): void => {
    generationRef.current += 1;
    sessionRef.current = null;
    setState({ status: "idle" });
  }, []);

  return {
    state,
    start,
    confirmLargeArchive,
    confirmMerge,
    keepAccount,
    cancel,
    dismiss,
  };
}

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
  type BlueskyArchiveMergeEnvironment,
  type BlueskyArchiveMergePreview,
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
  | { status: "done"; title: string; lines: string[] }
  | { status: "failed"; message: string };

/** The device capabilities an import needs, gathered so tests can stand in. */
export type BlueskyArchiveImportRuntime = {
  pickArchive(): Promise<{ uri: string } | null>;
  intake: BlueskyArchiveIntakeEnvironment;
  restore: BlueskyArchiveRestoreEnvironment;
  merge: BlueskyArchiveMergeEnvironment;
  /** Server-scheduled reminders, which reconciliation has to keep honest. */
  reminders: ScheduledReminderSync;
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
    reminders: NO_SCHEDULED_REMINDERS,
    newIntakeId: () => Crypto.randomUUID(),
  };
}

type Session = {
  intakeId: string;
  sourceUri: string;
  confirmedLargeArchive: boolean;
  cancelled: boolean;
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

  const environments = useCallback((): BlueskyArchiveImportRuntime => {
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
      cancelBlueskyArchiveIntake(environments().intake, session.intakeId);
    } catch (error) {
      console.warn("[archive-import] could not clear staging", error);
    }
    sessionRef.current = null;
  }, [environments]);

  const runRestore = useCallback(
    async (
      prepared: PreparedBlueskyArchive,
      environment: BlueskyArchiveRestoreEnvironment,
    ): Promise<void> => {
      setState({
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
          setState({
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
      setState({
        status: "done",
        title: `Restored @${result.handle}`,
        lines: [
          `${plural(result.counts.posts, "post")}, ${plural(result.counts.likes, "like")}, ${plural(result.counts.chats, "chat")}.`,
          `${plural(result.assets.restored, "file")} restored${result.assets.missing > 0 ? `, ${result.assets.missing} missing` : ""}.`,
          "This account is not connected to Bluesky. Sign in when you want Cyd to act on it.",
          ...(result.uuidRemapping ? [result.uuidRemapping.reason] : []),
        ],
      });
    },
    [],
  );

  const openMergePreview = useCallback(
    async (
      prepared: PreparedBlueskyArchive,
      environment: BlueskyArchiveMergeEnvironment,
      account: LocalAccountIdentity,
    ): Promise<void> => {
      setState({
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

      setState({
        status: "reviewing",
        preview,
        handle: account.handle ?? preview.accountDid,
      });
    },
    [],
  );

  /** Where this archive goes, decided by the DID intake reported. */
  const route = useCallback(
    async (
      prepared: PreparedBlueskyArchive,
      environment: Pick<BlueskyArchiveImportRuntime, "restore" | "merge">,
    ): Promise<void> => {
      const identities =
        await environment.merge.listLocalAccountIdentities();
      const destination = chooseBlueskyArchiveImportDestination(
        prepared.metadata.accountDid,
        identities,
      );

      if (destination.kind === "restore") {
        await runRestore(prepared, environment.restore);
        return;
      }
      if (destination.kind === "merge") {
        await openMergePreview(prepared, environment.merge, destination.account);
        return;
      }

      setState({
        status: "reconciling",
        message:
          "This device has more than one Bluesky account for the identity in this archive. Choose which one to keep before importing.",
        preview: await previewDuplicateReconciliation(environment.merge, {
          did: destination.did,
          accounts: identities,
        }),
      });
    },
    [openMergePreview, runRestore],
  );

  const run = useCallback(
    async (session: Session): Promise<void> => {
      const { intake, restore, merge } = environments();
      sessionRef.current = session;

      setState({
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
        shouldCancel: () => session.cancelled,
        onProgress: (progress) =>
          setState({
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
        setState({ status: "idle" });
        return;
      }
      if (outcome.status === "rejected") {
        // Intake clears staging for an archive it blames, and keeps it for a
        // failure it blames the device for, so that freeing space and trying
        // again resumes. Nothing offers to resume from here, so a rejection
        // ends the import and takes any staging with it either way.
        discardStaging();
        setState({ status: "failed", message: outcome.message });
        return;
      }
      if (outcome.status === "needs-confirmation") {
        setState({ status: "needs-confirmation", message: outcome.message });
        return;
      }

      sessionRef.current = { ...session, prepared: outcome };
      await route(outcome, { restore, merge });
    },
    [discardStaging, environments, route],
  );

  /** Pick the archive and take it as far as it can go without a decision. */
  const start = useCallback(async (): Promise<void> => {
    try {
      const picked = await environments().pickArchive();
      if (!picked) {
        return;
      }
      await run({
        intakeId: environments().newIntakeId(),
        sourceUri: picked.uri,
        confirmedLargeArchive: false,
        cancelled: false,
        prepared: null,
      });
    } catch (error) {
      discardStaging();
      setState({ status: "failed", message: messageFor(error) });
    }
  }, [discardStaging, environments, run]);

  const confirmLargeArchive = useCallback(async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    try {
      await run({ ...session, confirmedLargeArchive: true });
    } catch (error) {
      discardStaging();
      setState({ status: "failed", message: messageFor(error) });
    }
  }, [discardStaging, run]);

  /** Commit a merge the person has looked at. */
  const confirmMerge = useCallback(async (): Promise<void> => {
    if (state.status !== "reviewing") {
      return;
    }
    const { preview, handle } = state;
    try {
      setState({
        status: "working",
        message: "Merging the archive…",
        fraction: null,
        cancellable: false,
      });
      const result = await commitBlueskyArchiveMerge(
        environments().merge,
        preview,
        {
          onProgress: (progress) =>
            setState({
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
      setState({
        status: "done",
        title: `Merged into @${handle}`,
        lines:
          result.written === 0
            ? ["This archive held nothing that account did not already have."]
            : [
                `${plural(result.summary.restorations.total, "record")} came back.`,
                `${plural(result.summary.posts.updated + result.summary.messages.updated + result.summary.follows.updated, "record")} gained something.`,
                "Your settings, schedule and Bluesky connection were left as they were.",
              ],
      });
    } catch (error) {
      discardStaging();
      setState({ status: "failed", message: messageFor(error) });
    }
  }, [discardStaging, environments, state]);

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
      const { merge } = environments();
      try {
        setState({
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
        await syncReminders(
          reminders ?? environments().reminders,
          reconciled,
        );

        const survivor = (await merge.listLocalAccountIdentities()).find(
          (account) => account.uuid === choice.survivingUuid,
        );
        if (!survivor) {
          throw new Error(
            "Cyd could not find the Bluesky account it just kept.",
          );
        }
        await openMergePreview(prepared, merge, survivor);
      } catch (error) {
        discardStaging();
        setState({ status: "failed", message: messageFor(error) });
      }
    },
    [discardStaging, environments, openMergePreview, reminders, state],
  );

  /** Walk away: nothing has been written, and nothing stays staged. */
  const cancel = useCallback((): void => {
    const session = sessionRef.current;
    if (session) {
      session.cancelled = true;
    }
    discardStaging();
    setState({ status: "idle" });
  }, [discardStaging]);

  const dismiss = useCallback((): void => {
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

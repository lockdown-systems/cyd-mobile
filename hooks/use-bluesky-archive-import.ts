import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useRef, useState } from "react";

import {
  cancelBlueskyArchiveIntake,
  createBlueskyArchiveIntakeEnvironment,
  listResumableBlueskyArchiveIntakes,
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
  totalMergeChanges,
  type BlueskyArchiveMergeEnvironment,
  type BlueskyArchiveMergePreview,
  type BlueskyArchiveMergeResult,
} from "@/services/archive-merge";
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
 * large archive, and to agree to what a merge would add. Cancelling at either
 * point takes the staging with it.
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
 * Clear staging that an earlier launch left behind.
 *
 * Intake keeps a verified partial extraction on purpose, so that an import
 * killed by the operating system can be picked up rather than started over
 * (ADR 0006). Nothing in Mobile offers to pick one up, so what that policy
 * actually produces is a directory per abandoned import, each the size of the
 * archive it was reading, kept until the app is uninstalled.
 *
 * Starting an import is the moment to sweep them: it is the only thing that
 * creates them, the person is right there, and anything still in flight
 * belongs to a generation this one has already moved past. The day something
 * offers to resume an import, this is what it replaces.
 */
function discardAbandonedStaging(
  intake: BlueskyArchiveIntakeEnvironment,
): void {
  try {
    for (const abandoned of listResumableBlueskyArchiveIntakes(intake)) {
      cancelBlueskyArchiveIntake(intake, abandoned.intakeId);
    }
  } catch (error) {
    // Debris nobody can see is not worth failing an import over.
    console.warn("[archive-import] could not clear old staging", error);
  }
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * What a merge did, a line per kind of thing it did it to.
 *
 * The same headings the preview used, in the past tense: somebody who agreed
 * to "3 posts will be added" should be told that 3 posts were.
 */
function describeMergeResult(result: BlueskyArchiveMergeResult): string[] {
  if (result.written === 0) {
    return ["This archive held nothing that account did not already have."];
  }

  const totals = totalMergeChanges(result.summary);
  const added = result.summary.addedRecords;
  const kinds: [number, string][] = [
    [added.posts, "post"],
    [added.reposts, "repost"],
    [added.likes, "like"],
    [added.bookmarks, "bookmark"],
    [added.follows, "follow"],
    [added.chats, "chat"],
    [added.messages, "message"],
    [totals.files.added, "media file"],
  ];

  const lines = kinds
    .filter(([total]) => total > 0)
    .map(([total, noun]) => `${plural(total, noun)} added.`);

  if (totals.files.updated > 0) {
    lines.push(`${plural(totals.files.updated, "media file")} restored.`);
  }
  if (totals.records.updated > 0) {
    lines.push(`${plural(totals.records.updated, "record")} filled in.`);
  }
  if (lines.length === 0) {
    lines.push("Some records gained details this account was missing.");
  }
  return lines;
}

export function useBlueskyArchiveImport(
  options: {
    runtime?: BlueskyArchiveImportRuntime;
  } = {},
) {
  const { runtime } = options;
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
      await openMergePreview(
        prepared,
        ports.merge,
        destination.account,
        generation,
      );
    },
    [openMergePreview, runRestore],
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
      discardAbandonedStaging(importRuntime().intake);
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
    cancel,
    dismiss,
  };
}

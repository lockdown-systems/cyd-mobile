import { useModalBottomPadding } from "@/hooks/use-modal-bottom-padding";
import { useKeepAwake } from "expo-keep-awake";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Modal, ScrollView, Text, View } from "react-native";

import {
  ButtonRow,
  ErrorCard,
  InfoBar,
  StepRow,
  SuccessCard,
  styles,
  type AutomationModalState,
} from "@/components/account/AutomationModalShared";
import { RateLimitCountdown } from "@/components/account/RateLimitCountdown";
import { SpeechBubble } from "@/components/cyd/SpeechBubble";
import { MessagePreview } from "@/components/MessagePreview";
import { PostPreview } from "@/components/PostPreview";
import { ProfilePreview } from "@/components/ProfilePreview";
import {
  getBlueskyController,
  type BlueskyAccountController,
} from "@/controllers";
import type {
  BlueskyJobRecord,
  BlueskyJobRunUpdate,
  DeleteJobOptions,
  PreviewData,
} from "@/controllers/bluesky/job-types";
import type { AccountDeleteSettings } from "@/database/delete-settings";
import type { AccountTabPalette } from "@/types/account-tabs";
import { SimpleProgressBar } from "./SimpleProgressBar";

export type { AutomationModalState as DeleteAutomationModalState };

export type DeleteAutomationModalProps = {
  visible: boolean;
  accountId: number;
  accountUUID: string;
  palette: AccountTabPalette;
  settings: AccountDeleteSettings;
  counts: {
    posts: number;
    reposts: number;
    likes: number;
    bookmarks: number;
    messages: number;
    follows: number;
  };
  onFinished: (
    result: "completed" | "failed",
    jobs: BlueskyJobRecord[],
  ) => void;
  onClose: (jobs: BlueskyJobRecord[]) => void;
  onRestart?: (jobs: BlueskyJobRecord[]) => void;
};

export function DeleteAutomationModal({
  visible,
  accountId,
  accountUUID,
  palette,
  settings,
  counts,
  onFinished,
  onClose,
  onRestart,
}: DeleteAutomationModalProps) {
  // Keep the screen awake while automation is running
  useKeepAwake();
  const modalBottomPadding = useModalBottomPadding();

  const [jobs, setJobs] = useState<BlueskyJobRecord[]>([]);
  const [speech, setSpeech] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [state, setState] = useState<AutomationModalState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [rateLimitResetAt, setRateLimitResetAt] = useState<number | null>(null);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const controllerRef = useRef<BlueskyAccountController | null>(null);
  const controllerInitPromiseRef =
    useRef<Promise<BlueskyAccountController> | null>(null);
  const latestJobsRef = useRef<BlueskyJobRecord[]>([]);
  const isRunningRef = useRef(false);
  const cancelledRef = useRef(false);

  const handleClose = useCallback(() => {
    const controller = controllerRef.current;
    if (controller) {
      controller.cancel();
    }
    const jobs = latestJobsRef.current.map((job) =>
      job.status === "running" || job.status === "pending"
        ? { ...job, status: "canceled" as const }
        : job,
    );
    onClose(jobs);
  }, [onClose]);

  const handleRestart = useMemo(
    () => (onRestart ? () => onRestart(latestJobsRef.current) : undefined),
    [onRestart],
  );

  // Calculate total items to delete
  const totalItemsToDelete = useMemo(() => {
    let total = 0;
    if (settings.deletePosts) total += counts.posts;
    if (settings.deleteReposts) total += counts.reposts;
    if (settings.deleteLikes) total += counts.likes;
    if (settings.deleteBookmarks) total += counts.bookmarks;
    if (settings.deleteChats) total += counts.messages;
    if (settings.deleteUnfollowEveryone) total += counts.follows;
    return total;
  }, [settings, counts]);

  const resetUi = useCallback(() => {
    setSpeech(null);
    setProgressMessage(null);
    setError(null);
    setJobs([]);
    setPreviewData(null);
    setCurrentItemIndex(0);
    setTotalItems(totalItemsToDelete);
    setRateLimitResetAt(null);
    latestJobsRef.current = [];
  }, [totalItemsToDelete]);

  const ensureController = useCallback(async () => {
    if (controllerRef.current) {
      return controllerRef.current;
    }
    if (controllerInitPromiseRef.current) {
      return controllerInitPromiseRef.current;
    }
    console.log(
      "[DeleteAutomationModal] ensureController -> create",
      accountId,
    );
    const initPromise = (async () => {
      const controller = await getBlueskyController(accountId, accountUUID);
      controllerRef.current = controller;
      try {
        await controller.initAgent();
        console.log(
          "[DeleteAutomationModal] ensureController -> ready",
          accountId,
        );
      } catch (err) {
        if (err instanceof Error && err.name === "MissingBlueskySessionError") {
          // Expected when user is signed out; verifyAuthorization job will reauth.
          console.log(
            "[DeleteAutomationModal] ensureController -> missing session (signed out)",
            accountId,
          );
        } else {
          throw err;
        }
      }
      return controller;
    })();

    controllerInitPromiseRef.current = initPromise;

    try {
      return await initPromise;
    } finally {
      controllerInitPromiseRef.current = null;
    }
  }, [accountId, accountUUID]);

  const jobLabel = useMemo(
    () =>
      function label(jobType: BlueskyJobRecord["jobType"]): string {
        switch (jobType) {
          case "verifyAuthorization":
            return "Verify authorization";
          case "deletePosts":
            return "Delete posts";
          case "deleteReposts":
            return "Delete reposts";
          case "deleteLikes":
            return "Delete likes";
          case "deleteBookmarks":
            return "Delete bookmarks";
          case "deleteMessages":
            return "Delete chat messages";
          case "unfollowUsers":
            return "Unfollow users";
          default:
            return jobType;
        }
      },
    [],
  );

  useEffect(() => {
    cancelledRef.current = false;

    const run = async () => {
      if (!visible || isRunningRef.current) {
        return;
      }
      console.log("[DeleteAutomationModal] run -> start", accountId);
      isRunningRef.current = true;
      setState("running");
      setPaused(false);
      resetUi();

      try {
        const controller = await ensureController();
        const options: DeleteJobOptions = { settings, counts };
        const definedJobs = await controller.defineDeleteJobs(options);
        console.log(
          "[DeleteAutomationModal] jobs defined",
          accountId,
          definedJobs.length,
        );
        latestJobsRef.current = definedJobs;
        setJobs(definedJobs);

        const runJobsPromise = controller.runJobs({
          jobs: definedJobs,
          onUpdate: (update: BlueskyJobRunUpdate) => {
            if (cancelledRef.current) return;
            latestJobsRef.current = update.jobs;
            setJobs(update.jobs);
            setActiveJobId(update.activeJobId);
            if (update.speechText !== undefined) {
              setSpeech(update.speechText);
            }
            if (update.progressMessage !== undefined) {
              setProgressMessage(
                (update.progressMessage as string | undefined) ?? null,
              );
            }
            if (update.previewData !== undefined) {
              setPreviewData(update.previewData ?? null);
            }
            if (update.rateLimitResetAt !== undefined) {
              console.log(
                "[DeleteAutomationModal] rateLimitResetAt:",
                update.rateLimitResetAt,
              );
              setRateLimitResetAt(update.rateLimitResetAt ?? null);
            }
            // Track overall progress through items
            if (update.progress && typeof update.progress === "object") {
              const prog = update.progress as {
                currentItemIndex?: number;
                totalItems?: number;
              };
              if (prog.currentItemIndex !== undefined) {
                setCurrentItemIndex(prog.currentItemIndex);
              }
              if (prog.totalItems !== undefined) {
                setTotalItems(prog.totalItems);
              }
            }
          },
        });

        await runJobsPromise;
        if (cancelledRef.current) return;

        const failed = latestJobsRef.current.some(
          (job) => job.status === "failed",
        );
        setState(failed ? "failed" : "completed");
        if (failed) {
          const firstFail = latestJobsRef.current.find(
            (job) => job.status === "failed",
          );
          setError(firstFail?.error ?? "Deletion failed");
          onFinished("failed", latestJobsRef.current);
        } else {
          onFinished("completed", latestJobsRef.current);
        }
        console.log(
          "[DeleteAutomationModal] run -> finished",
          accountId,
          failed ? "failed" : "completed",
        );
      } catch (err) {
        if (cancelledRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setState("failed");
        onFinished("failed", latestJobsRef.current);
        console.warn("[DeleteAutomationModal] run -> error", accountId, err);
      } finally {
        isRunningRef.current = false;
      }
    };

    void run();

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    visible,
    settings,
    counts,
    onFinished,
    ensureController,
    accountId,
    // Note: resetUi intentionally excluded — it depends on totalItemsToDelete
    // which changes as items are deleted. Including it would restart the job.
  ]);

  useEffect(() => {
    if (!visible) {
      setPaused(false);
    }
  }, [visible]);

  useEffect(() => {
    setPreviewData(null);
    setRateLimitResetAt(null);
  }, [activeJobId]);

  useEffect(() => {
    return () => {
      const controller = controllerRef.current;
      if (isRunningRef.current) {
        console.warn(
          "[DeleteAutomationModal] unmount while run is active",
          accountId,
        );
      }
      // Clear callbacks and local refs only — the controller-manager owns the
      // controller lifecycle, so we do not dispose or close the DB here.
      if (controller) {
        controller.cancel();
        controller.clearProgressCallback();
        controllerRef.current = null;
      }
      controllerInitPromiseRef.current = null;
    };
  }, [accountId]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    let unsub: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const controller = await ensureController();
        if (cancelled) return;
        setPaused(controller.isPaused());
        unsub = controller.onPauseChange((next) => {
          setPaused(next);
        });
      } catch (err) {
        if (!cancelled) {
          console.warn(
            "[DeleteAutomationModal] pause subscription setup failed",
            accountId,
            err,
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [visible, ensureController, accountId]);

  const totalJobs = jobs.length;
  const completedCount = jobs.filter(
    (job) => job.status === "completed",
  ).length;
  const runningJob = jobs.find((job) => job.status === "running");
  const activeJob = (() => {
    if (activeJobId !== null) {
      const byId = jobs.find((job) => job.id === activeJobId);
      if (byId) return byId;
    }
    return runningJob;
  })();
  const statusForUi = activeJob?.status ?? runningJob?.status ?? "running";

  const currentIndex = (() => {
    if (activeJob) {
      return Math.max(jobs.findIndex((job) => job.id === activeJob.id) + 1, 1);
    }
    if (completedCount >= totalJobs) {
      return totalJobs || 0;
    }
    if (totalJobs === 0) return 0;
    return completedCount + 1;
  })();

  const currentLabel = (() => {
    if (activeJob) return jobLabel(activeJob.jobType);
    if (completedCount < totalJobs && jobs[completedCount]) {
      return jobLabel(jobs[completedCount].jobType);
    }
    if (totalJobs === 0) return "Preparing";
    return "Finished";
  })();

  // Calculate overall progress percentage based on items deleted
  const overallProgress = useMemo(() => {
    if (totalItems === 0) return 0;
    return Math.min(1, currentItemIndex / totalItems);
  }, [currentItemIndex, totalItems]);

  const handlePause = useCallback(async () => {
    const controller = await ensureController();
    controller.pause();
    setPaused(true);
  }, [ensureController]);

  const handleResume = useCallback(async () => {
    const controller = await ensureController();
    controller.resume();
    setPaused(false);
  }, [ensureController]);

  return (
    <Modal
      animationType="slide"
      presentationStyle="fullScreen"
      visible={visible}
      onRequestClose={handleClose}
    >
      <View
        style={[
          styles.modalContainer,
          {
            backgroundColor: palette.background,
            paddingBottom: modalBottomPadding,
          },
        ]}
      >
        <SpeechBubble message={speech ?? "Preparing to delete your data…"} />

        <StepRow
          currentIndex={currentIndex}
          totalJobs={totalJobs}
          currentLabel={currentLabel}
          statusForUi={statusForUi}
          palette={palette}
        />

        <SimpleProgressBar palette={palette} progress={overallProgress} />

        <View style={styles.progressCardWithCount}>
          <Text style={[styles.progressMessage, { color: palette.text }]}>
            {progressMessage ?? "Awaiting progress…"}
          </Text>
        </View>

        {/* Scrollable preview area */}
        <ScrollView
          style={styles.previewScrollView}
          contentContainerStyle={styles.previewScrollContent}
          showsVerticalScrollIndicator={true}
          bounces={true}
        >
          {/* Render appropriate preview based on previewData type */}
          {rateLimitResetAt ? (
            <RateLimitCountdown resetAt={rateLimitResetAt} palette={palette} />
          ) : previewData?.type === "post" ? (
            <PostPreview post={previewData.data} palette={palette} />
          ) : previewData?.type === "message" ? (
            <MessagePreview message={previewData.data} palette={palette} />
          ) : previewData?.type === "profile" ? (
            <ProfilePreview profile={previewData.data} palette={palette} />
          ) : null}
        </ScrollView>

        {state === "failed" && error ? (
          <ErrorCard error={error} palette={palette} />
        ) : null}

        {state === "completed" ? (
          <SuccessCard
            message="Deletion complete. You can close this dialog."
            palette={palette}
          />
        ) : null}

        <InfoBar
          message="Keep your phone unlocked and don't switch apps"
          palette={palette}
        />

        <ButtonRow
          state={state}
          paused={paused}
          palette={palette}
          onPause={handlePause}
          onResume={handleResume}
          onRestart={handleRestart}
          onClose={handleClose}
          restartLabel="Back to Delete Options"
        />
      </View>
    </Modal>
  );
}

export default DeleteAutomationModal;

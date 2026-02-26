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
  type AutomationModalState,
  ButtonRow,
  ErrorCard,
  InfoBar,
  StepRow,
  SuccessCard,
  styles,
} from "@/components/account/AutomationModalShared";
import { ConversationPreview } from "@/components/ConversationPreview";
import { SpeechBubble } from "@/components/cyd/SpeechBubble";
import { MessagePreview } from "@/components/MessagePreview";
import { PostPreview } from "@/components/PostPreview";
import { BlueskyAccountController } from "@/controllers";
import type {
  BlueskyJobRecord,
  BlueskyJobRunUpdate,
  SaveJobOptions,
} from "@/controllers/bluesky/job-types";
import type { PostPreviewData, PreviewData } from "@/controllers/bluesky/types";
import { useModalBottomPadding } from "@/hooks/use-modal-bottom-padding";
import type { AccountTabPalette } from "@/types/account-tabs";
import { SaveAutomationProgressBar } from "./SaveAutomationProgressBar";

export type { AutomationModalState as SaveAutomationModalState };

export type SaveAutomationModalProps = {
  visible: boolean;
  accountId: number;
  accountUUID: string;
  palette: AccountTabPalette;
  options: SaveJobOptions;
  onFinished: (
    result: "completed" | "failed",
    jobs: BlueskyJobRecord[],
  ) => void;
  onClose: (jobs: BlueskyJobRecord[]) => void;
  onRestart?: (jobs: BlueskyJobRecord[]) => void;
};

export function SaveAutomationModal({
  visible,
  accountId,
  accountUUID,
  palette,
  options,
  onFinished,
  onClose,
  onRestart,
}: SaveAutomationModalProps) {
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
  const [activeJobProgress, setActiveJobProgress] = useState(0);
  const [activeJobUnknownTotal, setActiveJobUnknownTotal] = useState(false);
  const [previewPost, setPreviewPost] = useState<PostPreviewData | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const controllerRef = useRef<BlueskyAccountController | null>(null);
  const latestJobsRef = useRef<BlueskyJobRecord[]>([]);
  const isRunningRef = useRef(false);

  const handleClose = useCallback(() => {
    onClose(latestJobsRef.current);
  }, [onClose]);

  const handleRestart = useMemo(
    () => (onRestart ? () => onRestart(latestJobsRef.current) : undefined),
    [onRestart],
  );

  const resetUi = () => {
    setSpeech(null);
    setProgressMessage(null);
    setError(null);
    setJobs([]);
    setPreviewPost(null);
    setPreviewData(null);
    setActiveJobUnknownTotal(false);
    latestJobsRef.current = [];
  };

  const ensureController = useCallback(async () => {
    if (controllerRef.current) {
      return controllerRef.current;
    }
    console.log("[SaveAutomationModal] ensureController -> create", accountId);
    const controller = new BlueskyAccountController(accountId, accountUUID);
    controllerRef.current = controller;
    controller.setProgressCallback(() => {
      // progress is reported via job events
    });
    await controller.initDB();
    try {
      await controller.initAgent();
      console.log("[SaveAutomationModal] ensureController -> ready", accountId);
    } catch (err) {
      if (err instanceof Error && err.name === "MissingBlueskySessionError") {
        // Expected when user is signed out; verifyAuthorization job will reauth.
        console.log(
          "[SaveAutomationModal] ensureController -> missing session (signed out)",
          accountId,
        );
      } else {
        throw err;
      }
    }
    return controller;
  }, [accountId, accountUUID]);

  const jobLabel = useMemo(
    () =>
      function label(jobType: BlueskyJobRecord["jobType"]): string {
        switch (jobType) {
          case "verifyAuthorization":
            return "Verify authorization";
          case "savePosts":
            return "Save posts";
          case "saveLikes":
            return "Save likes";
          case "saveBookmarks":
            return "Save bookmarks";
          case "saveChatConvos":
            return "Save chat conversations";
          case "saveChatMessages":
            return "Save chat messages";
          default:
            return jobType;
        }
      },
    [],
  );

  const isPreviewPost = (value: unknown): value is PostPreviewData => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<PostPreviewData>;
    return (
      typeof candidate.uri === "string" &&
      typeof candidate.cid === "string" &&
      typeof candidate.text === "string" &&
      typeof candidate.author === "object" &&
      candidate.author !== null &&
      typeof (candidate.author as { did?: unknown }).did === "string" &&
      typeof (candidate.author as { handle?: unknown }).handle === "string"
    );
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!visible || isRunningRef.current) {
        return;
      }
      console.log("[SaveAutomationModal] run -> start", accountId);
      isRunningRef.current = true;
      setState("running");
      setPaused(false);
      resetUi();

      try {
        const controller = await ensureController();
        const definedJobs = await controller.defineSaveJobs(options);
        console.log(
          "[SaveAutomationModal] jobs defined",
          accountId,
          definedJobs.length,
        );
        latestJobsRef.current = definedJobs;
        setJobs(definedJobs);

        await controller.runJobs({
          jobs: definedJobs,
          onUpdate: (update: BlueskyJobRunUpdate) => {
            if (cancelled) return;
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
            if (update.progressPercent !== undefined) {
              setActiveJobProgress(update.progressPercent);
            }
            if (update.unknownTotal !== undefined) {
              setActiveJobUnknownTotal(update.unknownTotal);
            }
            if (update.previewPost !== undefined) {
              setPreviewPost(
                isPreviewPost(update.previewPost) ? update.previewPost : null,
              );
            }
            if (update.previewData !== undefined) {
              setPreviewData(update.previewData);
            }
          },
        });
        if (cancelled) return;

        const failed = latestJobsRef.current.some(
          (job) => job.status === "failed",
        );
        setState(failed ? "failed" : "completed");
        if (failed) {
          const firstFail = latestJobsRef.current.find(
            (job) => job.status === "failed",
          );
          setError(firstFail?.error ?? "Automation failed");
          onFinished("failed", latestJobsRef.current);
        } else {
          onFinished("completed", latestJobsRef.current);
        }
        console.log(
          "[SaveAutomationModal] run -> finished",
          accountId,
          failed ? "failed" : "completed",
        );
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setState("failed");
        onFinished("failed", latestJobsRef.current);
        console.warn("[SaveAutomationModal] run -> error", accountId, err);
      } finally {
        isRunningRef.current = false;
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [visible, options, onFinished, ensureController, accountId]);

  useEffect(() => {
    if (!visible) {
      setPaused(false);
    }
  }, [visible]);

  useEffect(() => {
    setActiveJobProgress(0);
    setPreviewPost(null);
    setPreviewData(null);
  }, [activeJobId]);

  useEffect(() => {
    return () => {
      const controller = controllerRef.current;
      if (controller) {
        void controller.cleanup();
        controllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const controller = await ensureController();
      if (cancelled) return;
      setPaused(controller.isPaused());
      unsub = controller.onPauseChange((next) => {
        setPaused(next);
      });
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [ensureController]);

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
        <SpeechBubble message={speech ?? "Preparing to start…"} />

        <StepRow
          currentIndex={currentIndex}
          totalJobs={totalJobs}
          currentLabel={currentLabel}
          statusForUi={statusForUi}
          palette={palette}
        />

        <SaveAutomationProgressBar
          palette={palette}
          jobs={jobs}
          activeJobProgress={activeJobProgress}
          activeJobUnknownTotal={activeJobUnknownTotal}
        />

        <View style={styles.progressCard}>
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
          {/* Render appropriate preview based on previewData type, or fall back to legacy previewPost */}
          {previewData?.type === "post" ? (
            <PostPreview post={previewData.data} palette={palette} />
          ) : previewData?.type === "conversation" ? (
            <ConversationPreview
              conversation={previewData.data}
              palette={palette}
            />
          ) : previewData?.type === "message" ? (
            <MessagePreview message={previewData.data} palette={palette} />
          ) : previewPost ? (
            <PostPreview post={previewPost} palette={palette} />
          ) : null}
        </ScrollView>

        {state === "failed" && error ? (
          <ErrorCard error={error} palette={palette} />
        ) : null}

        {state === "completed" ? (
          <SuccessCard
            message="Finished. You can close this dialog."
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
          restartLabel="Back to Save Options"
        />
      </View>
    </Modal>
  );
}

export default SaveAutomationModal;

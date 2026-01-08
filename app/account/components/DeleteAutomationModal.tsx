import { MaterialIcons } from "@expo/vector-icons";
import { useKeepAwake } from "expo-keep-awake";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { SpeechBubble } from "@/components/cyd/SpeechBubble";
import { MessagePreview } from "@/components/MessagePreview";
import { PostPreview } from "@/components/PostPreview";
import { ProfilePreview } from "@/components/ProfilePreview";
import { BlueskyAccountController } from "@/controllers";
import type {
  BlueskyJobRecord,
  BlueskyJobRunUpdate,
  DeleteJobOptions,
  PreviewData,
} from "@/controllers/bluesky/job-types";
import type { AccountDeleteSettings } from "@/database/delete-settings";
import type { AccountTabPalette } from "@/types/account-tabs";
import { DeleteAutomationProgressBar } from "./DeleteAutomationProgressBar";

export type DeleteAutomationModalState =
  | "idle"
  | "running"
  | "failed"
  | "completed";

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
    jobs: BlueskyJobRecord[]
  ) => void;
  onClose: () => void;
  onRestart?: () => void;
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

  const [jobs, setJobs] = useState<BlueskyJobRecord[]>([]);
  const [speech, setSpeech] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [state, setState] = useState<DeleteAutomationModalState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [_activeJobProgress, setActiveJobProgress] = useState(0);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const controllerRef = useRef<BlueskyAccountController | null>(null);
  const latestJobsRef = useRef<BlueskyJobRecord[]>([]);
  const isRunningRef = useRef(false);

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
    latestJobsRef.current = [];
  }, [totalItemsToDelete]);

  const ensureController = useCallback(async () => {
    if (controllerRef.current) {
      return controllerRef.current;
    }
    console.log(
      "[DeleteAutomationModal] ensureController -> create",
      accountId
    );
    const controller = new BlueskyAccountController(accountId, accountUUID);
    controllerRef.current = controller;
    controller.setProgressCallback(() => {
      // progress is reported via job events
    });
    await controller.initDB();
    try {
      await controller.initAgent();
      console.log(
        "[DeleteAutomationModal] ensureController -> ready",
        accountId
      );
    } catch (err) {
      if (err instanceof Error && err.name === "MissingBlueskySessionError") {
        // Expected when user is signed out; verifyAuthorization job will reauth.
        console.log(
          "[DeleteAutomationModal] ensureController -> missing session (signed out)",
          accountId
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
    []
  );

  useEffect(() => {
    let cancelled = false;

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
          definedJobs.length
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
                (update.progressMessage as string | undefined) ?? null
              );
            }
            if (update.progressPercent !== undefined) {
              setActiveJobProgress(update.progressPercent);
            }
            if (update.previewData !== undefined) {
              setPreviewData(update.previewData ?? null);
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
        if (cancelled) return;

        const failed = latestJobsRef.current.some(
          (job) => job.status === "failed"
        );
        setState(failed ? "failed" : "completed");
        if (failed) {
          const firstFail = latestJobsRef.current.find(
            (job) => job.status === "failed"
          );
          setError(firstFail?.error ?? "Deletion failed");
          onFinished("failed", latestJobsRef.current);
        } else {
          onFinished("completed", latestJobsRef.current);
        }
        console.log(
          "[DeleteAutomationModal] run -> finished",
          accountId,
          failed ? "failed" : "completed"
        );
      } catch (err) {
        if (cancelled) return;
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
      cancelled = true;
    };
  }, [
    visible,
    settings,
    counts,
    onFinished,
    ensureController,
    accountId,
    resetUi,
  ]);

  useEffect(() => {
    if (!visible) {
      setPaused(false);
    }
  }, [visible]);

  useEffect(() => {
    setActiveJobProgress(0);
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

  const statusIcon = (status: BlueskyJobRecord["status"]) => {
    if (status === "completed") return "check-circle" as const;
    if (status === "running") return "play-circle" as const;
    if (status === "failed") return "error-outline" as const;
    return "schedule" as const;
  };

  const statusColor = (status: BlueskyJobRecord["status"]) => {
    if (status === "failed") return palette.warning ?? palette.tint;
    if (status === "completed") return palette.tint;
    if (status === "running") return palette.tint;
    return palette.icon;
  };

  const totalJobs = jobs.length;
  const completedCount = jobs.filter(
    (job) => job.status === "completed"
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
      onRequestClose={onClose}
    >
      <View
        style={[styles.modalContainer, { backgroundColor: palette.background }]}
      >
        <SpeechBubble message={speech ?? "Preparing to delete your data…"} />

        <View style={styles.stepRow}>
          <MaterialIcons
            name={statusIcon(statusForUi)}
            size={20}
            color={statusColor(statusForUi)}
          />
          <Text style={[styles.stepText, { color: palette.text }]}>
            Step {Math.max(currentIndex, 0)}/{Math.max(totalJobs, 0)}:{" "}
            {currentLabel}
          </Text>
        </View>

        <DeleteAutomationProgressBar
          palette={palette}
          progress={overallProgress}
          currentItemIndex={currentItemIndex}
          totalItems={totalItems}
        />

        <View style={styles.progressCard}>
          <Text style={[styles.progressMessage, { color: palette.text }]}>
            {progressMessage ?? "Awaiting progress…"}
          </Text>
          <Text style={[styles.itemCount, { color: palette.icon }]}>
            {currentItemIndex.toLocaleString()} / {totalItems.toLocaleString()}{" "}
            items
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
          {previewData?.type === "post" ? (
            <PostPreview post={previewData.data} palette={palette} />
          ) : previewData?.type === "message" ? (
            <MessagePreview message={previewData.data} palette={palette} />
          ) : previewData?.type === "profile" ? (
            <ProfilePreview profile={previewData.data} palette={palette} />
          ) : null}
        </ScrollView>

        {state === "failed" && error ? (
          <View
            style={[
              styles.errorCard,
              {
                borderColor: palette.icon + "22",
                backgroundColor: palette.card,
              },
            ]}
          >
            <MaterialIcons
              name="error-outline"
              size={20}
              color={palette.warning ?? palette.tint}
            />
            <Text style={[styles.errorText, { color: palette.text }]}>
              {error}
            </Text>
          </View>
        ) : null}

        {state === "completed" ? (
          <View
            style={[
              styles.successCard,
              {
                borderColor: palette.icon + "22",
                backgroundColor: palette.card,
              },
            ]}
          >
            <MaterialIcons name="check-circle" size={24} color={palette.tint} />
            <Text style={[styles.statusText, { color: palette.text }]}>
              Deletion complete. You can close this dialog.
            </Text>
          </View>
        ) : null}

        <View
          style={[styles.infoBar, { backgroundColor: palette.icon + "11" }]}
        >
          <MaterialIcons
            name="info-outline"
            size={16}
            color={palette.icon}
            style={{ opacity: 0.7 }}
          />
          <Text style={[styles.infoText, { color: palette.text }]}>
            Keep your phone unlocked and don&apos;t switch apps
          </Text>
        </View>

        <View style={styles.buttonRow}>
          {state === "running" ? (
            <SecondaryButton
              label={paused ? "Resume" : "Pause"}
              palette={palette}
              onPress={paused ? handleResume : handlePause}
              iconName={paused ? "play-arrow" : "pause"}
              variant={paused ? "resume" : "pause"}
            />
          ) : (
            <SecondaryButton
              label={onRestart ? "Back to Delete Options" : "Close"}
              palette={palette}
              onPress={onRestart ?? onClose}
            />
          )}
          <DangerButton label="Cancel" palette={palette} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function SecondaryButton({
  label,
  palette,
  onPress,
  iconName,
  variant = "default",
}: {
  label: string;
  palette: AccountTabPalette;
  onPress: () => void | Promise<void>;
  iconName?: React.ComponentProps<typeof MaterialIcons>["name"];
  variant?: "default" | "pause" | "resume";
}) {
  const isResume = variant === "resume";
  const isPause = variant === "pause";
  const backgroundColor = isResume ? "#1fa971" : palette.card;
  const borderColor = isResume ? "#1fa971" : palette.icon + "33";
  const textColor = isResume ? "#ffffff" : palette.text;
  const paddingVertical = isResume ? 12 : 10;
  const paddingHorizontal = isResume ? 24 : 20;

  return (
    <Pressable
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => [
        styles.secondaryButton,
        {
          borderColor,
          backgroundColor,
          paddingVertical,
          paddingHorizontal,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      accessibilityRole="button"
    >
      <View style={styles.buttonContent}>
        {iconName ? (
          <MaterialIcons
            name={iconName}
            size={18}
            color={textColor}
            style={{ marginRight: 6, opacity: isPause ? 0.8 : 1 }}
          />
        ) : null}
        <Text style={[styles.secondaryButtonText, { color: textColor }]}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function DangerButton({
  label,
  palette,
  onPress,
  disabled,
}: {
  label: string;
  palette: AccountTabPalette;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const backgroundColor = palette.danger ?? "#b00020";
  return (
    <Pressable
      onPress={
        disabled
          ? undefined
          : () => {
              void onPress();
            }
      }
      style={({ pressed }) => [
        styles.dangerButton,
        {
          backgroundColor,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      <Text style={styles.dangerButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 16,
  },
  progressCard: {
    alignItems: "center",
    paddingVertical: 8,
    gap: 4,
  },
  previewScrollView: {
    flex: 1,
    minHeight: 0,
  },
  previewScrollContent: {
    flexGrow: 0,
    paddingBottom: 8,
  },
  progressMessage: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
  },
  itemCount: {
    fontSize: 14,
    textAlign: "center",
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
  },
  successCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
  },
  infoBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  infoText: {
    fontSize: 13,
    opacity: 0.8,
  },
  buttonRow: {
    marginTop: "auto",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  secondaryButton: {
    borderRadius: 14,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  statusText: {
    fontSize: 15,
    textAlign: "center",
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stepText: {
    fontSize: 15,
    fontWeight: "600",
  },
  dangerButton: {
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  dangerButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
});

export default DeleteAutomationModal;

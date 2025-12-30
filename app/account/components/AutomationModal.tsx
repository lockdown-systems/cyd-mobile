import { MaterialIcons } from "@expo/vector-icons";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { SpeechBubble } from "@/components/cyd/SpeechBubble";
import { BlueskyAccountController } from "@/controllers";
import type {
  BlueskyJobRecord,
  BlueskyJobRunUpdate,
  SaveJobOptions,
} from "@/controllers/bluesky/job-types";
import type { AccountTabPalette } from "@/types/account-tabs";

export type AutomationModalState = "idle" | "running" | "failed" | "completed";

export type AutomationModalProps = {
  visible: boolean;
  accountId: number;
  palette: AccountTabPalette;
  options: SaveJobOptions;
  onFinished: (result: "completed" | "failed") => void;
  onClose: () => void;
  onRestart?: () => void;
};

export function AutomationModal({
  visible,
  accountId,
  palette,
  options,
  onFinished,
  onClose,
  onRestart,
}: AutomationModalProps) {
  const [jobs, setJobs] = useState<BlueskyJobRecord[]>([]);
  const [speech, setSpeech] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [state, setState] = useState<AutomationModalState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const controllerRef = useRef<BlueskyAccountController | null>(null);
  const latestJobsRef = useRef<BlueskyJobRecord[]>([]);
  const isRunningRef = useRef(false);

  const resetUi = () => {
    setSpeech(null);
    setProgress(null);
    setDetail(null);
    setError(null);
    setJobs([]);
    latestJobsRef.current = [];
  };

  const ensureController = useCallback(async () => {
    if (controllerRef.current) {
      return controllerRef.current;
    }
    console.log("[AutomationModal] ensureController -> create", accountId);
    const controller = new BlueskyAccountController(accountId);
    controllerRef.current = controller;
    controller.setProgressCallback(() => {
      // progress is reported via job events
    });
    await controller.initDB();
    try {
      await controller.initAgent();
      console.log("[AutomationModal] ensureController -> ready", accountId);
    } catch (err) {
      if (err instanceof Error && err.name === "MissingBlueskySessionError") {
        // Expected when user is signed out; verifyAuthorization job will reauth.
        console.log(
          "[AutomationModal] ensureController -> missing session (signed out)",
          accountId
        );
      } else {
        throw err;
      }
    }
    return controller;
  }, [accountId]);

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
          case "saveChats":
            return "Save chats";
          case "saveFollowing":
            return "Save following";
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
      console.log("[AutomationModal] run -> start", accountId);
      isRunningRef.current = true;
      setState("running");
      setPaused(false);
      resetUi();

      try {
        const controller = await ensureController();
        const definedJobs = await controller.defineJobs(options);
        console.log(
          "[AutomationModal] jobs defined",
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
            if (update.speechText !== undefined) {
              setSpeech(update.speechText);
            }
            if (update.progressText !== undefined) {
              setProgress(update.progressText);
            }
            if (update.detailText !== undefined) {
              setDetail(update.detailText);
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
          setError(firstFail?.error ?? "Automation failed");
          onFinished("failed");
        } else {
          onFinished("completed");
        }
        console.log(
          "[AutomationModal] run -> finished",
          accountId,
          failed ? "failed" : "completed"
        );
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setState("failed");
        onFinished("failed");
        console.warn("[AutomationModal] run -> error", accountId, err);
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

  const currentIndex = (() => {
    if (runningJob) {
      return jobs.findIndex((job) => job.id === runningJob.id) + 1;
    }
    if (completedCount >= totalJobs) {
      return totalJobs || 0;
    }
    return completedCount + 1;
  })();

  const currentLabel = (() => {
    if (runningJob) return jobLabel(runningJob.jobType);
    if (completedCount < totalJobs && jobs[completedCount]) {
      return jobLabel(jobs[completedCount].jobType);
    }
    if (totalJobs === 0) return "Preparing";
    return "Finished";
  })();

  const progressPercent = (() => {
    if (totalJobs === 0) return 0;
    const hasVerify = jobs.some((job) => job.jobType === "verifyAuthorization");
    const remainingCount = hasVerify ? Math.max(totalJobs - 1, 0) : totalJobs;
    const verifyWeight = hasVerify ? 2 : 0;
    const remainingWeight = hasVerify ? 98 : 100;
    const perJobWeight =
      remainingCount > 0 ? remainingWeight / remainingCount : 0;

    const weightForJob = (job: BlueskyJobRecord) =>
      job.jobType === "verifyAuthorization" ? verifyWeight : perJobWeight;

    const completedWeight = jobs
      .filter((job) => job.status === "completed")
      .reduce((sum, job) => sum + weightForJob(job), 0);

    const runningWeight = runningJob ? weightForJob(runningJob) * 0.5 : 0;

    const percent = completedWeight + runningWeight;
    return Math.max(0, Math.min(100, percent));
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
      onRequestClose={onClose}
    >
      <View
        style={[styles.modalContainer, { backgroundColor: palette.background }]}
      >
        <SpeechBubble message={speech ?? "Preparing to start…"} />

        <View style={styles.stepRow}>
          <MaterialIcons
            name={statusIcon(runningJob ? runningJob.status : "running")}
            size={20}
            color={statusColor(runningJob ? runningJob.status : "running")}
          />
          <Text style={[styles.stepText, { color: palette.text }]}>
            Step {Math.max(currentIndex, 0)}/{Math.max(totalJobs, 0)}:{" "}
            {currentLabel}
          </Text>
        </View>

        <View style={styles.progressBarContainer}>
          <View
            style={[
              styles.progressBarFill,
              {
                width: `${progressPercent}%`,
                backgroundColor: palette.tint,
              },
            ]}
          />
        </View>

        <View
          style={[
            styles.progressCard,
            { borderColor: palette.icon + "22", backgroundColor: palette.card },
          ]}
        >
          <Text style={[styles.progressLabel, { color: palette.icon }]}>
            {progress ?? "Awaiting progress…"}
          </Text>
          {detail ? (
            <Text style={[styles.progressDetail, { color: palette.text }]}>
              {detail}
            </Text>
          ) : null}
        </View>

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
              Finished. You can close this dialog.
            </Text>
          </View>
        ) : null}

        <View style={styles.buttonRow}>
          {state === "running" ? (
            <SecondaryButton
              label={paused ? "Resume" : "Pause"}
              palette={palette}
              onPress={paused ? handleResume : handlePause}
            />
          ) : (
            <SecondaryButton
              label={onRestart ? "Back to Save Options" : "Close"}
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
}: {
  label: string;
  palette: AccountTabPalette;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => [
        styles.secondaryButton,
        {
          borderColor: palette.icon + "33",
          backgroundColor: palette.card,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      accessibilityRole="button"
    >
      <Text style={[styles.secondaryButtonText, { color: palette.text }]}>
        {label}
      </Text>
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
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  progressLabel: {
    fontSize: 14,
  },
  progressDetail: {
    fontSize: 13,
    lineHeight: 18,
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
  buttonRow: {
    marginTop: "auto",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  secondaryButton: {
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
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
  progressBarContainer: {
    height: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
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

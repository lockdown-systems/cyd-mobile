import { MaterialIcons } from "@expo/vector-icons";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

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
    const controller = new BlueskyAccountController(accountId);
    controllerRef.current = controller;
    controller.setProgressCallback(() => {
      // progress is reported via job events
    });
    await controller.initDB();
    await controller.initAgent();
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
      isRunningRef.current = true;
      setState("running");
      setPaused(false);
      resetUi();

      try {
        const controller = await ensureController();
        const definedJobs = await controller.defineJobs(options);
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
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setState("failed");
        onFinished("failed");
      } finally {
        isRunningRef.current = false;
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [visible, options, onFinished, ensureController]);

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
        <View style={styles.modalHeader}>
          <Text style={[styles.headline, { color: palette.text }]}>
            Automation
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={styles.closeButton}
          >
            <MaterialIcons name="close" size={24} color={palette.text} />
          </Pressable>
        </View>

        <View
          style={[
            styles.speechBubble,
            { borderColor: palette.icon + "22", backgroundColor: palette.card },
          ]}
        >
          <Text style={[styles.speechText, { color: palette.text }]}>
            {speech ?? "Preparing to start…"}
          </Text>
        </View>

        <View style={styles.statusList}>
          {jobs.map((job) => (
            <View
              key={job.id}
              style={[styles.statusRow, { borderColor: palette.icon + "22" }]}
            >
              <MaterialIcons
                name={statusIcon(job.status)}
                size={20}
                color={statusColor(job.status)}
              />
              <Text style={[styles.statusLabel, { color: palette.text }]}>
                {jobLabel(job.jobType)}
              </Text>
              <Text style={[styles.statusValue, { color: palette.icon }]}>
                {job.status}
              </Text>
            </View>
          ))}
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

        <View style={styles.modalFooter}>
          {state === "running" ? (
            <>
              <SecondaryButton
                label={paused ? "Resume" : "Pause"}
                palette={palette}
                onPress={paused ? handleResume : handlePause}
              />
              <PrimaryButton
                label="Close"
                palette={palette}
                onPress={onClose}
              />
            </>
          ) : (
            <>
              <SecondaryButton
                label={onRestart ? "Back to Save Options" : "Close"}
                palette={palette}
                onPress={onRestart ?? onClose}
              />
              <PrimaryButton
                label="Close"
                palette={palette}
                onPress={onClose}
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function PrimaryButton({
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
  const backgroundColor = palette.button?.background ?? palette.tint;
  const textColor = palette.button?.text ?? "#ffffff";
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
        styles.primaryButton,
        {
          backgroundColor,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      <Text style={[styles.primaryButtonText, { color: textColor }]}>
        {label}
      </Text>
    </Pressable>
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

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    paddingTop: 32,
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headline: {
    fontSize: 22,
    fontWeight: "700",
  },
  closeButton: {
    padding: 8,
    borderRadius: 999,
  },
  speechBubble: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 14,
  },
  speechText: {
    fontSize: 16,
    lineHeight: 22,
  },
  statusList: {
    gap: 8,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  statusLabel: {
    flex: 1,
    fontSize: 15,
  },
  statusValue: {
    fontSize: 13,
    textTransform: "capitalize",
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
  modalFooter: {
    marginTop: "auto",
    gap: 12,
  },
  primaryButton: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: "center",
    alignSelf: "center",
    minWidth: 220,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 32,
    alignSelf: "center",
    minWidth: 220,
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
});

import { MaterialIcons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { BlueskyJobRecord } from "@/controllers/bluesky/job-types";
import type { AccountTabPalette } from "@/types/account-tabs";

/**
 * Shared types and state for automation modals (save and delete).
 */
export type AutomationModalState = "idle" | "running" | "failed" | "completed";

/**
 * Common props shared between save and delete automation modals.
 */
export type AutomationModalBaseProps = {
  visible: boolean;
  accountId: number;
  accountUUID: string;
  palette: AccountTabPalette;
  onFinished: (
    result: "completed" | "failed",
    jobs: BlueskyJobRecord[],
  ) => void;
  onClose: (jobs: BlueskyJobRecord[]) => void;
  onRestart?: (jobs: BlueskyJobRecord[]) => void;
};

/**
 * Status icon helper function.
 */
export function getStatusIcon(
  status: BlueskyJobRecord["status"],
): "check-circle" | "play-circle" | "error-outline" | "schedule" {
  if (status === "completed") return "check-circle";
  if (status === "running") return "play-circle";
  if (status === "failed") return "error-outline";
  return "schedule";
}

/**
 * Status color helper function.
 */
export function getStatusColor(
  status: BlueskyJobRecord["status"],
  palette: AccountTabPalette,
): string {
  if (status === "failed") return palette.warning ?? palette.tint;
  if (status === "completed") return palette.tint;
  if (status === "running") return palette.tint;
  return palette.icon;
}

/**
 * Secondary button component for automation modals.
 */
export function SecondaryButton({
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

/**
 * Danger button component for automation modals.
 */
export function DangerButton({
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

/**
 * Error card component for displaying errors.
 */
export function ErrorCard({
  error,
  palette,
}: {
  error: string;
  palette: AccountTabPalette;
}) {
  return (
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
      <Text style={[styles.errorText, { color: palette.text }]}>{error}</Text>
    </View>
  );
}

/**
 * Success card component for displaying completion message.
 */
export function SuccessCard({
  message,
  palette,
}: {
  message: string;
  palette: AccountTabPalette;
}) {
  return (
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
        {message}
      </Text>
    </View>
  );
}

/**
 * Info bar component for displaying instructions.
 */
export function InfoBar({
  message,
  palette,
}: {
  message: string;
  palette: AccountTabPalette;
}) {
  return (
    <View style={[styles.infoBar, { backgroundColor: palette.icon + "11" }]}>
      <MaterialIcons
        name="info-outline"
        size={16}
        color={palette.icon}
        style={{ opacity: 0.7 }}
      />
      <Text style={[styles.infoText, { color: palette.text }]}>{message}</Text>
    </View>
  );
}

/**
 * Step row component showing current job step.
 */
export function StepRow({
  currentIndex,
  totalJobs,
  currentLabel,
  statusForUi,
  palette,
}: {
  currentIndex: number;
  totalJobs: number;
  currentLabel: string;
  statusForUi: BlueskyJobRecord["status"];
  palette: AccountTabPalette;
}) {
  return (
    <View style={styles.stepRow}>
      <MaterialIcons
        name={getStatusIcon(statusForUi)}
        size={20}
        color={getStatusColor(statusForUi, palette)}
      />
      <Text style={[styles.stepText, { color: palette.text }]}>
        Step {Math.max(currentIndex, 0)}/{Math.max(totalJobs, 0)}:{" "}
        {currentLabel}
      </Text>
    </View>
  );
}

/**
 * Button row for pause/resume and cancel buttons.
 */
export function ButtonRow({
  state,
  paused,
  palette,
  onPause,
  onResume,
  onRestart,
  onClose,
  restartLabel,
}: {
  state: AutomationModalState;
  paused: boolean;
  palette: AccountTabPalette;
  onPause: () => void | Promise<void>;
  onResume: () => void | Promise<void>;
  onRestart?: () => void;
  onClose: () => void;
  restartLabel: string;
}) {
  return (
    <View style={styles.buttonRow}>
      {state === "running" ? (
        <SecondaryButton
          label={paused ? "Resume" : "Pause"}
          palette={palette}
          onPress={paused ? onResume : onPause}
          iconName={paused ? "play-arrow" : "pause"}
          variant={paused ? "resume" : "pause"}
        />
      ) : (
        <SecondaryButton
          label={onRestart ? restartLabel : "Close"}
          palette={palette}
          onPress={onRestart ?? onClose}
        />
      )}
      <DangerButton label="Stop Now" palette={palette} onPress={onClose} />
    </View>
  );
}

/**
 * Shared styles for automation modal components.
 */
export const styles = StyleSheet.create({
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
    paddingHorizontal: 16,
  },
  progressCardWithCount: {
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
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
    flexWrap: "wrap",
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

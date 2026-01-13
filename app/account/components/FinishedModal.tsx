import { MaterialIcons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { BlueskyJobRecord } from "@/controllers/bluesky/job-types";
import type { AccountTabPalette } from "@/types/account-tabs";

export type FinishedModalMode = "save" | "delete" | "schedule";

export type FinishedModalProps = {
  visible: boolean;
  palette: AccountTabPalette;
  jobs: BlueskyJobRecord[];
  mode?: FinishedModalMode;
  onClose: () => void;
  onViewDashboard?: () => void;
  onViewBrowse?: () => void;
  onViewDelete?: () => void;
};

function jobLabel(jobType: BlueskyJobRecord["jobType"]): string {
  switch (jobType) {
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
    case "deletePosts":
      return "Delete posts";
    case "deleteReposts":
      return "Delete reposts";
    case "deleteLikes":
      return "Delete likes";
    case "deleteBookmarks":
      return "Delete bookmarks";
    case "deleteMessages":
      return "Delete messages";
    case "unfollowUsers":
      return "Unfollow everyone";
    default:
      return jobType;
  }
}

function statusIcon(
  status: BlueskyJobRecord["status"]
): React.ComponentProps<typeof MaterialIcons>["name"] {
  if (status === "completed") return "check-circle";
  if (status === "failed") return "error-outline";
  if (status === "running") return "play-circle";
  return "schedule";
}

function statusColor(
  status: BlueskyJobRecord["status"],
  palette: AccountTabPalette
): string {
  if (status === "failed") return palette.warning ?? palette.tint;
  if (status === "completed") return palette.tint;
  if (status === "running") return palette.tint;
  return palette.icon;
}

type MaybeProgress = {
  postsProgress?: { current?: number | null };
  likesProgress?: { current?: number | null };
  bookmarksProgress?: { current?: number | null };
  conversationsProgress?: { current?: number | null };
  messagesProgress?: { current?: number | null };
  currentItemIndex?: number | null;
  totalItems?: number | null;
};

function extractSavedCount(job: BlueskyJobRecord): number | null {
  const progress = job.progress as MaybeProgress | undefined;
  if (!progress) return null;

  switch (job.jobType) {
    case "savePosts":
      return progress.postsProgress?.current ?? null;
    case "saveLikes":
      return progress.likesProgress?.current ?? null;
    case "saveBookmarks":
      return progress.bookmarksProgress?.current ?? null;
    case "saveChatConvos":
      return progress.conversationsProgress?.current ?? null;
    case "saveChatMessages":
      return progress.messagesProgress?.current ?? null;
    case "deletePosts":
    case "deleteReposts":
    case "deleteLikes":
    case "deleteBookmarks":
    case "deleteMessages":
    case "unfollowUsers":
      return progress.currentItemIndex ?? null;
    default:
      return null;
  }
}

function formattedSavedCount(job: BlueskyJobRecord): string | null {
  const count = extractSavedCount(job);
  if (typeof count !== "number" || Number.isNaN(count)) return null;

  switch (job.jobType) {
    case "savePosts":
      return `Saved ${count.toLocaleString()} posts`;
    case "saveLikes":
      return `Saved ${count.toLocaleString()} likes`;
    case "saveBookmarks":
      return `Saved ${count.toLocaleString()} bookmarks`;
    case "saveChatConvos":
      return `Saved ${count.toLocaleString()} conversations`;
    case "saveChatMessages":
      return `Saved ${count.toLocaleString()} messages`;
    case "deletePosts":
      return `Deleted ${count.toLocaleString()} posts`;
    case "deleteReposts":
      return `Deleted ${count.toLocaleString()} reposts`;
    case "deleteLikes":
      return `Deleted ${count.toLocaleString()} likes`;
    case "deleteBookmarks":
      return `Deleted ${count.toLocaleString()} bookmarks`;
    case "deleteMessages":
      return `Deleted ${count.toLocaleString()} messages`;
    case "unfollowUsers":
      return `Unfollowed ${count.toLocaleString()} accounts`;
    default:
      return null;
  }
}

function formatDuration(ms: number | null): string {
  if (!ms || ms < 0) return "";
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

export function FinishedModal({
  visible,
  palette,
  jobs,
  mode = "save",
  onClose,
  onViewDashboard,
  onViewBrowse,
  onViewDelete,
}: FinishedModalProps) {
  const orderedJobs = useMemo(
    () => [...jobs].sort((a, b) => a.scheduledAt - b.scheduledAt),
    [jobs]
  );
  const displayJobs = useMemo(
    () => orderedJobs.filter((job) => job.jobType !== "verifyAuthorization"),
    [orderedJobs]
  );
  const failedJob = useMemo(
    () => jobs.find((job) => job.status === "failed"),
    [jobs]
  );
  const totalDuration = useMemo(() => {
    const startTimes = jobs
      .map((job) => job.startedAt ?? job.scheduledAt)
      .filter((value) => typeof value === "number");
    const finishTimes = jobs
      .map((job) => job.finishedAt ?? job.startedAt ?? job.scheduledAt)
      .filter((value) => typeof value === "number");
    if (startTimes.length === 0 || finishTimes.length === 0) {
      return "";
    }
    const start = Math.min(...startTimes);
    const end = Math.max(...finishTimes);
    return formatDuration(end - start);
  }, [jobs]);

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={visible}
      onRequestClose={() => {
        if (onViewDashboard) {
          onViewDashboard();
        } else {
          onClose();
        }
      }}
    >
      <View style={[styles.container, { backgroundColor: palette.background }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: palette.text }]}>
            {mode === "schedule"
              ? "Finished saving and deleting Bluesky data"
              : mode === "delete"
                ? "Finished deleting Bluesky data"
                : "Finished saving Bluesky data"}
          </Text>
        </View>
        <View
          style={[
            styles.summaryCard,
            {
              borderColor: palette.icon + "22",
              backgroundColor: palette.card,
            },
          ]}
        >
          <View style={styles.summaryRow}>
            <MaterialIcons
              name={failedJob ? "error-outline" : "timer"}
              size={18}
              color={palette.icon}
            />
            <Text style={[styles.summaryText, { color: palette.text }]}>
              {totalDuration ? `Total time: ${totalDuration}` : "Finished"}
            </Text>
          </View>
          {failedJob ? (
            <View style={styles.summaryRow}>
              <MaterialIcons
                name="info-outline"
                size={18}
                color={palette.icon}
              />
              <Text
                style={[styles.summaryText, { color: palette.text }]}
                numberOfLines={2}
              >
                {failedJob.error ?? "Automation reported a failure"}
              </Text>
            </View>
          ) : null}
        </View>

        <ScrollView
          style={styles.jobList}
          contentContainerStyle={styles.jobListContent}
          showsVerticalScrollIndicator={false}
        >
          {displayJobs.map((job) => {
            const duration =
              job.startedAt !== null && job.finishedAt !== null
                ? formatDuration(job.finishedAt - job.startedAt)
                : "";
            const savedLabel = formattedSavedCount(job);
            return (
              <View
                key={job.id}
                style={[styles.jobRow, { borderColor: palette.icon + "22" }]}
              >
                <MaterialIcons
                  name={statusIcon(job.status)}
                  size={22}
                  color={statusColor(job.status, palette)}
                />
                <View style={styles.jobTextWrap}>
                  <Text style={[styles.jobLabel, { color: palette.text }]}>
                    {savedLabel ?? jobLabel(job.jobType)}
                  </Text>
                  <Text style={[styles.jobDetail, { color: palette.icon }]}>
                    {job.status === "completed"
                      ? duration
                        ? `Completed in ${duration}`
                        : "Completed"
                      : job.status === "failed"
                        ? (job.error ?? "Failed")
                        : job.status === "running"
                          ? "In progress"
                          : "Pending"}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.buttonRow}>
          <Pressable
            onPress={() => {
              if (mode === "delete" || mode === "schedule") {
                onClose();
              } else if (onViewDashboard) {
                onViewDashboard();
              } else {
                onClose();
              }
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
              Close
            </Text>
          </Pressable>
          {mode === "save" && onViewDelete ? (
            <Pressable
              onPress={() => {
                onViewDelete();
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: palette.button?.background ?? palette.tint,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              accessibilityRole="button"
            >
              <Text
                style={[
                  styles.primaryButtonText,
                  { color: palette.button?.text ?? "#ffffff" },
                ]}
              >
                Delete Data
              </Text>
            </Pressable>
          ) : null}
          {onViewBrowse ? (
            <Pressable
              onPress={() => {
                onViewBrowse();
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: palette.button?.background ?? palette.tint,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              accessibilityRole="button"
            >
              <Text
                style={[
                  styles.primaryButtonText,
                  { color: palette.button?.text ?? "#ffffff" },
                ]}
              >
                Browse Data
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 40,
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 15,
  },
  summaryCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  summaryText: {
    fontSize: 15,
    flex: 1,
  },
  jobList: {
    flex: 1,
    minHeight: 0,
  },
  jobListContent: {
    gap: 10,
    paddingBottom: 8,
  },
  jobRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
  },
  jobTextWrap: {
    flex: 1,
    gap: 2,
  },
  jobLabel: {
    fontSize: 16,
    fontWeight: "600",
  },
  jobDetail: {
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 4,
  },
  primaryButton: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: "center",
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryButton: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
});

export default FinishedModal;

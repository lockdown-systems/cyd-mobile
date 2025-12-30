import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import type { BlueskyJobRecord } from "@/controllers/bluesky/job-types";
import type { AccountTabPalette } from "@/types/account-tabs";

type AutomationProgressBarProps = {
  jobs: BlueskyJobRecord[];
  activeJobProgress: number;
  palette: AccountTabPalette;
};

export function AutomationProgressBar({
  jobs,
  activeJobProgress,
  palette,
}: AutomationProgressBarProps) {
  const progressPercent = useMemo(() => {
    if (jobs.length === 0) return 0;

    const hasVerify = jobs.some((job) => job.jobType === "verifyAuthorization");
    const verifyWeight = hasVerify ? 2 : 0;
    const remainingWeight = 100 - verifyWeight;
    const nonVerifyJobs = jobs.filter(
      (job) => job.jobType !== "verifyAuthorization"
    );
    const perJobWeight =
      nonVerifyJobs.length > 0 ? remainingWeight / nonVerifyJobs.length : 0;

    let percent = 0;
    const clampedProgress = Math.max(0, Math.min(1, activeJobProgress));

    for (const job of jobs) {
      if (job.jobType === "verifyAuthorization") {
        if (job.status === "completed") {
          percent += verifyWeight;
        }
        continue;
      }

      if (job.status === "completed") {
        percent += perJobWeight;
      } else if (job.status === "running") {
        percent += perJobWeight * clampedProgress;
      }
    }

    return Math.max(0, Math.min(100, percent));
  }, [jobs, activeJobProgress]);

  return (
    <View style={styles.progressBarContainer}>
      <View
        style={[
          styles.progressBarFill,
          { width: `${progressPercent}%`, backgroundColor: palette.tint },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  progressBarContainer: {
    height: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
  },
});

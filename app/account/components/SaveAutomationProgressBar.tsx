import React, { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

import type { BlueskyJobRecord } from "@/controllers/bluesky/job-types";
import type { AccountTabPalette } from "@/types/account-tabs";

type SaveAutomationProgressBarProps = {
  jobs: BlueskyJobRecord[];
  activeJobProgress: number;
  activeJobUnknownTotal: boolean;
  palette: AccountTabPalette;
};

type SegmentState = "empty" | "full" | "filling" | "animating";

type SegmentInfo = {
  jobId: number;
  weight: number; // percentage width (0-100)
  state: SegmentState;
  fillPercent: number; // 0-1 for "filling" state
};

function AnimatedStripes({
  width,
  tintColor,
}: {
  width: `${number}%`;
  tintColor: string;
}) {
  const translateX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(translateX, {
        toValue: 20,
        duration: 600,
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [translateX]);

  // Create diagonal stripe pattern using multiple overlapping stripes
  const stripeCount = 30;
  const stripes = Array.from({ length: stripeCount }, (_, i) => (
    <Animated.View
      key={i}
      style={[
        styles.stripe,
        {
          backgroundColor: tintColor,
          left: i * 20 - 200,
          transform: [{ translateX }, { skewX: "-30deg" }],
        },
      ]}
    />
  ));

  return (
    <View style={[styles.animatingSegment, { width }]}>
      <View
        style={[styles.stripeContainer, { backgroundColor: tintColor + "66" }]}
      >
        {stripes}
      </View>
    </View>
  );
}

export function SaveAutomationProgressBar({
  jobs,
  activeJobProgress,
  activeJobUnknownTotal,
  palette,
}: SaveAutomationProgressBarProps) {
  const segments = useMemo((): SegmentInfo[] => {
    if (jobs.length === 0) return [];

    const hasVerify = jobs.some((job) => job.jobType === "verifyAuthorization");
    const verifyWeight = hasVerify ? 2 : 0;
    const remainingWeight = 100 - verifyWeight;
    const nonVerifyJobs = jobs.filter(
      (job) => job.jobType !== "verifyAuthorization"
    );
    const perJobWeight =
      nonVerifyJobs.length > 0 ? remainingWeight / nonVerifyJobs.length : 0;

    return jobs.map((job) => {
      const weight =
        job.jobType === "verifyAuthorization" ? verifyWeight : perJobWeight;

      let state: SegmentState = "empty";
      let fillPercent = 0;

      if (job.status === "completed") {
        state = "full";
        fillPercent = 1;
      } else if (job.status === "running") {
        if (activeJobUnknownTotal) {
          state = "animating";
          fillPercent = 0;
        } else {
          state = "filling";
          fillPercent = Math.max(0, Math.min(1, activeJobProgress));
        }
      }

      return {
        jobId: job.id,
        weight,
        state,
        fillPercent,
      };
    });
  }, [jobs, activeJobProgress, activeJobUnknownTotal]);

  return (
    <View
      style={[
        styles.progressBarContainer,
        { borderColor: palette.icon + "44" },
      ]}
    >
      {segments.map((segment) => {
        const widthPercent = `${segment.weight}%`;

        if (segment.state === "empty") {
          return (
            <View
              key={segment.jobId}
              style={[styles.segment, { width: widthPercent as `${number}%` }]}
            />
          );
        }

        if (segment.state === "full") {
          return (
            <View
              key={segment.jobId}
              style={[
                styles.segment,
                styles.fullSegment,
                {
                  width: widthPercent as `${number}%`,
                  backgroundColor: palette.tint,
                },
              ]}
            />
          );
        }

        if (segment.state === "animating") {
          return (
            <AnimatedStripes
              key={segment.jobId}
              width={widthPercent as `${number}%`}
              tintColor={palette.tint}
            />
          );
        }

        // "filling" state
        return (
          <View
            key={segment.jobId}
            style={[styles.segment, { width: widthPercent as `${number}%` }]}
          >
            <View
              style={[
                styles.fillProgress,
                {
                  width: `${segment.fillPercent * 100}%`,
                  backgroundColor: palette.tint,
                },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  progressBarContainer: {
    flexDirection: "row",
    height: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  segment: {
    height: "100%",
    overflow: "hidden",
  },
  fullSegment: {
    // filled segment
  },
  fillProgress: {
    height: "100%",
  },
  animatingSegment: {
    height: "100%",
    overflow: "hidden",
  },
  stripeContainer: {
    flex: 1,
    flexDirection: "row",
    overflow: "hidden",
  },
  stripe: {
    position: "absolute",
    width: 10,
    height: "200%",
    top: -10,
  },
});

export default SaveAutomationProgressBar;

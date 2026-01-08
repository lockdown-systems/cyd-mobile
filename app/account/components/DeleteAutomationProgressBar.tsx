import React from "react";
import { StyleSheet, View } from "react-native";

import type { AccountTabPalette } from "@/types/account-tabs";

type DeleteAutomationProgressBarProps = {
  palette: AccountTabPalette;
  /** Progress from 0 to 1 */
  progress: number;
  /** Current item index (for display) */
  currentItemIndex: number;
  /** Total items to process */
  totalItems: number;
};

/**
 * A simpler progress bar for delete operations that shows actual progress
 * based on the known total items to delete.
 */
export function DeleteAutomationProgressBar({
  palette,
  progress,
}: DeleteAutomationProgressBarProps) {
  const fillPercent = Math.max(0, Math.min(1, progress)) * 100;

  return (
    <View
      style={[
        styles.progressBarContainer,
        { borderColor: palette.icon + "44" },
      ]}
    >
      <View
        style={[
          styles.fillProgress,
          {
            width: `${fillPercent}%`,
            backgroundColor: palette.tint,
          },
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
    backgroundColor: "transparent",
  },
  fillProgress: {
    height: "100%",
  },
});

export default DeleteAutomationProgressBar;

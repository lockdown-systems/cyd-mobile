import React from "react";
import { StyleSheet, View } from "react-native";

import type { AccountTabPalette } from "@/types/account-tabs";

type SimpleProgressBarProps = {
  palette: AccountTabPalette;
  /** Progress from 0 to 1 */
  progress: number;
};

/**
 * A simple progress bar that shows linear progress based on a known percentage.
 * Used for operations where the total count is known upfront (like delete operations).
 */
export function SimpleProgressBar({
  palette,
  progress,
}: SimpleProgressBarProps) {
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

export default SimpleProgressBar;

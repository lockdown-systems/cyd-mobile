import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import type { AccountTabPalette } from "@/types/account-tabs";

const monoFont = Platform.select({
  ios: "ui-monospace",
  default: "monospace",
});

function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return "00:00";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) {
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(m)}:${pad(s)}`;
}

function formatResumeTime(resetAtSeconds: number): string {
  const date = new Date(resetAtSeconds * 1000);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function RateLimitCountdown({
  resetAt,
  palette,
}: {
  resetAt: number;
  palette: AccountTabPalette;
}) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, resetAt - Math.floor(Date.now() / 1000)),
  );

  useEffect(() => {
    setRemaining(Math.max(0, resetAt - Math.floor(Date.now() / 1000)));
    const interval = setInterval(() => {
      const left = resetAt - Math.floor(Date.now() / 1000);
      setRemaining(Math.max(0, left));
      if (left <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [resetAt]);

  return (
    <View style={styles.container}>
      <Text
        style={[styles.countdown, { color: palette.text }]}
        accessibilityRole="timer"
      >
        {formatCountdown(remaining)}
      </Text>

      <Text style={[styles.resumeText, { color: palette.text }]}>
        Continuing at about {formatResumeTime(resetAt)}
      </Text>

      <View style={styles.warningRow}>
        <Text style={[styles.warningText, { color: palette.icon }]}>
          You won&apos;t be able to post to Bluesky yourself until the rate
          limit expires.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    gap: 12,
  },
  countdown: {
    fontSize: 80,
    fontWeight: "700",
    fontFamily: monoFont,
    letterSpacing: 2,
  },
  resumeText: {
    fontSize: 20,
    opacity: 0.85,
    textAlign: "center",
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 50,
    paddingHorizontal: 16,
  },
  warningText: {
    fontSize: 14,
    opacity: 0.7,
    textAlign: "left",
    flexShrink: 1,
  },
});

import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  getLastDeletedAt,
  getLastSavedAt,
  getLastScheduledDeletionAt,
} from "@/database/accounts";
import type { AccountTabPalette } from "@/types/account-tabs";

type LastActionTimestampProps = {
  accountId: number;
  palette: AccountTabPalette;
  actionType: "save" | "delete" | "schedule";
  refreshKey?: number;
};

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const ACTION_LABELS = {
  save: "saved your data",
  delete: "deleted your data",
  schedule: "ran a scheduled deletion",
} as const;

export function LastActionTimestamp({
  accountId,
  palette,
  actionType,
  refreshKey,
}: LastActionTimestampProps) {
  const [timestamp, setTimestamp] = useState<number | null | undefined>(
    undefined
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let ts: number | null = null;
      switch (actionType) {
        case "save":
          ts = await getLastSavedAt(accountId);
          break;
        case "delete":
          ts = await getLastDeletedAt(accountId);
          break;
        case "schedule":
          ts = await getLastScheduledDeletionAt(accountId);
          break;
      }
      if (!cancelled) {
        setTimestamp(ts);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, actionType, refreshKey]);

  // Still loading or never performed action
  if (timestamp === undefined || timestamp === null) {
    return null;
  }

  return (
    <View
      style={[
        styles.container,
        {
          borderColor: palette.icon + "22",
          backgroundColor: palette.card,
        },
      ]}
    >
      <Text style={[styles.text, { color: palette.icon }]}>
        You last {ACTION_LABELS[actionType]} on {formatTimestamp(timestamp)}.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  text: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "left",
  },
});

export default LastActionTimestamp;

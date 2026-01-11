import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { getLastDeletedAt, getLastSavedAt } from "@/database/accounts";
import type { AccountTabKey, AccountTabPalette } from "@/types/account-tabs";

type SaveAndDeleteStatusBannerProps = {
  accountId: number;
  palette: AccountTabPalette;
  onSelectTab?: (tab: AccountTabKey) => void;
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

export function SaveAndDeleteStatusBanner({
  accountId,
  palette,
  onSelectTab,
  refreshKey,
}: SaveAndDeleteStatusBannerProps) {
  const [lastSavedAt, setLastSavedAt] = useState<number | null | undefined>(
    undefined
  );
  const [lastDeletedAt, setLastDeletedAt] = useState<number | null | undefined>(
    undefined
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const savedTs = await getLastSavedAt(accountId);
      if (!cancelled) {
        setLastSavedAt(savedTs);
      }
      const deletedTs = await getLastDeletedAt(accountId);
      if (!cancelled) {
        setLastDeletedAt(deletedTs);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, refreshKey]);

  // Still loading
  if (lastSavedAt === undefined || lastDeletedAt === undefined) {
    return null;
  }

  const hasSavedData = lastSavedAt !== null;
  const hasDeletedData = lastDeletedAt !== null;

  // User has both saved and deleted - don't show anything
  if (hasSavedData && hasDeletedData) {
    return null;
  }

  // User has not saved or has saved but not deleted
  return (
    <View
      style={[
        styles.banner,
        {
          borderColor: palette.tint + "44",
          backgroundColor: palette.tint + "11",
        },
      ]}
    >
      <View style={styles.contentContainer}>
        <Text style={[styles.messageText, { color: palette.text }]}>
          You need to manually save your data and then delete your data at least
          once before you can schedule deletion.
        </Text>
        {hasSavedData && lastSavedAt && (
          <Text style={[styles.timestampText, { color: palette.icon }]}>
            You last saved your data on {formatTimestamp(lastSavedAt)}.
          </Text>
        )}
        <View style={styles.buttonRow}>
          <Pressable
            onPress={() => onSelectTab?.("save")}
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
              Save Data
            </Text>
          </Pressable>
          {hasSavedData && (
            <Pressable
              onPress={() => onSelectTab?.("delete")}
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
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "column",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 12,
    gap: 12,
  },
  contentContainer: {
    flex: 1,
    gap: 12,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },
  timestampText: {
    fontSize: 14,
    lineHeight: 20,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
  },
  primaryButton: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
});

export default SaveAndDeleteStatusBanner;

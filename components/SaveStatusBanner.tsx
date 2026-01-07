import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { getLastSavedAt } from "@/database/accounts";
import type { AccountTabKey, AccountTabPalette } from "@/types/account-tabs";

type SaveStatusBannerProps = {
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

export function SaveStatusBanner({
  accountId,
  palette,
  onSelectTab,
  refreshKey,
}: SaveStatusBannerProps) {
  const [lastSavedAt, setLastSavedAt] = useState<number | null | undefined>(
    undefined
  );

  useEffect(() => {
    void (async () => {
      const ts = await getLastSavedAt(accountId);
      setLastSavedAt(ts);
    })();
  }, [accountId, refreshKey]);

  // Still loading
  if (lastSavedAt === undefined) {
    return null;
  }

  // User has never saved data - show prompt with Cyd avatar
  if (lastSavedAt === null) {
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
        <View style={styles.topRow}>
          <View style={styles.contentContainer}>
            <Text style={[styles.messageText, { color: palette.text }]}>
              You need to save data before you can delete it.
            </Text>
            <View style={styles.buttonColumn}>
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
                  Go to Save Tab
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // User has saved data - show simple status message
  return (
    <View
      style={[
        styles.simpleBanner,
        {
          borderColor: palette.icon + "22",
          backgroundColor: palette.card,
        },
      ]}
    >
      <Text style={[styles.simpleText, { color: palette.icon }]}>
        You last saved your data on {formatTimestamp(lastSavedAt)}.
      </Text>
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
  topRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  avatarContainer: {
    flexShrink: 0,
    width: 80,
    height: 80,
  },
  contentContainer: {
    flex: 1,
    gap: 12,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },
  buttonColumn: {
    gap: 8,
    alignItems: "center",
  },
  primaryButton: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: "center",
    alignSelf: "center",
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  simpleBanner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
  },
  simpleText: {
    fontSize: 14,
    lineHeight: 20,
  },
});

export default SaveStatusBanner;

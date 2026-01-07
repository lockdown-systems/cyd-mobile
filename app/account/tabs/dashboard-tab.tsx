import { useCallback, useEffect, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from "react-native";

import iconArchive from "@/assets/images/icon-archive.png";
import iconDatabase from "@/assets/images/icon-database.png";
import iconDelete from "@/assets/images/icon-delete.png";
import { SpeechBubble } from "@/components/cyd/SpeechBubble";
import { useCydAccount } from "@/contexts/CydAccountProvider";
import { getLastSavedAt } from "@/database/accounts";
import type { AccountTabKey, AccountTabProps } from "@/types/account-tabs";

type DashboardCard = {
  key: AccountTabKey;
  title: string;
  description: (handle: string) => string;
  icon: ImageSourcePropType;
};

const CARDS: DashboardCard[] = [
  {
    key: "save",
    title: "Save My Data",
    description: (handle) =>
      "Make or update your local backup. You must do this before you delete anything.",
    icon: iconDatabase,
  },
  {
    key: "delete",
    title: "Delete My Data",
    description: (handle) =>
      "Delete your posts, reposts, likes, and/or chat messages. If you want, delete your bookmarks and unfollow everyone.",
    icon: iconDelete,
  },
  {
    key: "browse",
    title: "Browse Archive",
    description: (handle) => "Browse your local backup of Bluesky data.",
    icon: iconArchive,
  },
];

export function DashboardTab({
  accountId,
  handle,
  palette,
  onSelectTab,
}: AccountTabProps) {
  const { state: cydState, apiClient } = useCydAccount();
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [hasPremium, setHasPremium] = useState<boolean | null>(null);

  // Load last saved timestamp
  useEffect(() => {
    void (async () => {
      const ts = await getLastSavedAt(accountId);
      setLastSavedAt(ts);
    })();
  }, [accountId]);

  // Check premium access
  const checkPremiumAccess = useCallback(async () => {
    if (!cydState.isSignedIn) {
      setHasPremium(false);
      return;
    }
    try {
      const response = await apiClient.getUserPremium();
      if ("error" in response) {
        setHasPremium(false);
      } else {
        setHasPremium(response.premium_access);
      }
    } catch {
      setHasPremium(false);
    }
  }, [cydState.isSignedIn, apiClient]);

  useEffect(() => {
    void checkPremiumAccess();
  }, [checkPremiumAccess]);

  const hasSavedData = lastSavedAt !== null;

  const getBadge = (cardKey: AccountTabKey): "startHere" | "premium" | null => {
    if (cardKey === "save" && !hasSavedData) {
      return "startHere";
    }
    if (cardKey === "delete" && !hasPremium) {
      return "premium";
    }
    return null;
  };

  return (
    <>
      <SpeechBubble message="It's your data.\n\n**What do you want to do with it?**" />
      <ScrollView
        contentContainerStyle={[styles.grid, { paddingBottom: 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {CARDS.map((card) => {
          const badge = getBadge(card.key);
          return (
            <Pressable
              key={card.key}
              onPress={() => onSelectTab?.(card.key)}
              style={({ pressed }) => [
                styles.card,
                {
                  borderColor: palette.icon + "22",
                  backgroundColor: palette.card,
                  opacity: pressed ? 0.92 : 1,
                },
              ]}
            >
              {badge !== null && (
                <View
                  style={[
                    styles.badge,
                    badge === "startHere"
                      ? { backgroundColor: palette.tint }
                      : { backgroundColor: "#9333ea" },
                  ]}
                >
                  <Text style={styles.badgeText}>
                    {badge === "startHere" ? "Start Here" : "Premium"}
                  </Text>
                </View>
              )}
              <Image source={card.icon} style={styles.icon} />
              <View style={styles.textStack}>
                <Text style={[styles.title, { color: palette.text }]}>
                  {card.title}
                </Text>
                <Text style={[styles.description, { color: palette.icon }]}>
                  {card.description(handle)}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexGrow: 1,
    gap: 8,
  },
  card: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    flexDirection: "row",
    gap: 16,
    alignItems: "center",
    position: "relative",
    overflow: "hidden",
  },
  badge: {
    position: "absolute",
    top: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomLeftRadius: 12,
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  icon: {
    width: 64,
    height: 64,
  },
  textStack: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 6,
    textAlign: "left",
  },
  description: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: "left",
  },
});

export default DashboardTab;

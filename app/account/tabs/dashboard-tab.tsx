import { useEffect, useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from "react-native";

import iconBrowse from "@/assets/images/icon-browse.png";
import iconDelete from "@/assets/images/icon-delete.png";
import iconSave from "@/assets/images/icon-save.png";
import iconSchedule from "@/assets/images/icon-schedule.png";
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
    icon: iconSave,
  },
  {
    key: "delete",
    title: "Delete My Data",
    description: (handle) =>
      "Delete your posts, reposts, likes, and/or chat messages. If you want, delete your bookmarks and unfollow everyone.",
    icon: iconDelete,
  },
  {
    key: "schedule",
    title: "Schedule Deletion",
    description: (handle) =>
      "Schedule deletion of your data based on your save and delete settings.",
    icon: iconSchedule,
  },
  {
    key: "browse",
    title: "Browse Archive",
    description: (handle) => "Browse your local backup of Bluesky data.",
    icon: iconBrowse,
  },
];

export function DashboardTab({
  accountId,
  handle,
  palette,
  onSelectTab,
}: AccountTabProps) {
  const { state: cydState, checkPremiumAccess } = useCydAccount();
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // Load last saved timestamp
  useEffect(() => {
    void (async () => {
      const ts = await getLastSavedAt(accountId);
      setLastSavedAt(ts);
    })();
  }, [accountId]);

  // Check premium access (only if not already checked)
  useEffect(() => {
    if (cydState.hasPremiumAccess === null) {
      void checkPremiumAccess();
    }
  }, [cydState.hasPremiumAccess, checkPremiumAccess]);

  const hasSavedData = lastSavedAt !== null;
  // Use cached premium status, default to showing premium badges if not yet checked
  const hasPremium = cydState.hasPremiumAccess ?? false;

  const getBadge = (cardKey: AccountTabKey): "startHere" | "premium" | null => {
    if (cardKey === "save" && !hasSavedData) {
      return "startHere";
    }
    if (cardKey === "delete" && !hasPremium) {
      return "premium";
    }
    if (cardKey === "schedule" && !hasPremium) {
      return "premium";
    }
    return null;
  };

  return (
    <View style={styles.container}>
      <SpeechBubble
        avatarHeight={80}
        message="It's your data. **What do you want to do with it?**"
      />
      <View style={styles.grid}>
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
              <View style={styles.iconContainer}>
                <Image source={card.icon} style={styles.icon} />
              </View>
              <Text style={[styles.title, { color: palette.text }]}>
                {card.title}
              </Text>
              <Text style={[styles.description, { color: palette.icon }]}>
                {card.description(handle)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  grid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignContent: "stretch",
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    flexBasis: "48%",
    flexGrow: 1,
    maxWidth: "49%",
    alignItems: "center",
    justifyContent: "flex-start",
    position: "relative",
    overflow: "hidden",
  },
  badge: {
    position: "absolute",
    top: 0,
    right: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomLeftRadius: 10,
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  iconContainer: {
    marginTop: 15,
    marginBottom: 8,
  },
  icon: {
    width: 60,
    height: 60,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
    textAlign: "center",
  },
  description: {
    fontSize: 15,
    lineHeight: 18,
    textAlign: "left",
    marginTop: "auto",
    marginBottom: "auto",
  },
});

export default DashboardTab;

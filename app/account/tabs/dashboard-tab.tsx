import { useEffect, useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
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

const TABLET_BREAKPOINT = 768;
const TABLET_CONTENT_MAX_WIDTH = 760;
const TABLET_CARD_MIN_HEIGHT = 240;

export function DashboardTab({
  accountId,
  handle,
  palette,
  onSelectTab,
}: AccountTabProps) {
  const { width } = useWindowDimensions();
  const { state: cydState, checkPremiumAccess } = useCydAccount();
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const isTablet = width >= TABLET_BREAKPOINT;

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
    <View style={[styles.container, isTablet && styles.tabletContainer]}>
      <View
        style={[styles.contentStack, isTablet && styles.tabletContentStack]}
      >
        <SpeechBubble
          avatarHeight={isTablet ? 108 : 80}
          prominentOnTablet={isTablet}
          message="It's your data. **What do you want to do with it?**"
        />
        <View style={[styles.grid, isTablet && styles.tabletGrid]}>
          {CARDS.map((card) => {
            const badge = getBadge(card.key);
            return (
              <Pressable
                key={card.key}
                onPress={() => onSelectTab?.(card.key)}
                style={({ pressed }) => [
                  styles.card,
                  isTablet && styles.tabletCard,
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
                      isTablet && styles.tabletBadge,
                      badge === "startHere"
                        ? { backgroundColor: palette.tint }
                        : { backgroundColor: "#9333ea" },
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        isTablet && styles.tabletBadgeText,
                      ]}
                    >
                      {badge === "startHere" ? "Start Here" : "Premium"}
                    </Text>
                  </View>
                )}
                <View
                  style={[
                    styles.iconContainer,
                    isTablet && styles.tabletIconContainer,
                  ]}
                >
                  <Image
                    source={card.icon}
                    style={[styles.icon, isTablet && styles.tabletIcon]}
                  />
                </View>
                <Text
                  style={[
                    styles.title,
                    isTablet && styles.tabletTitle,
                    { color: palette.text },
                  ]}
                >
                  {card.title}
                </Text>
                <Text
                  style={[
                    styles.description,
                    isTablet && styles.tabletDescription,
                    { color: palette.icon },
                  ]}
                >
                  {card.description(handle)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabletContainer: {
    width: "100%",
    maxWidth: TABLET_CONTENT_MAX_WIDTH,
    alignSelf: "center",
  },
  contentStack: {
    flex: 1,
  },
  tabletContentStack: {
    justifyContent: "center",
    paddingTop: 20,
    paddingBottom: 56,
  },
  grid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignContent: "stretch",
  },
  tabletGrid: {
    flex: 0,
    alignContent: "flex-start",
    gap: 12,
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
  tabletCard: {
    minHeight: TABLET_CARD_MIN_HEIGHT,
    padding: 22,
  },
  badge: {
    position: "absolute",
    top: 0,
    right: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomLeftRadius: 10,
  },
  tabletBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  tabletBadgeText: {
    fontSize: 11,
  },
  iconContainer: {
    marginTop: 15,
    marginBottom: 8,
  },
  tabletIconContainer: {
    marginTop: 22,
    marginBottom: 14,
  },
  icon: {
    width: 60,
    height: 60,
  },
  tabletIcon: {
    width: 72,
    height: 72,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 4,
    textAlign: "center",
  },
  tabletTitle: {
    fontSize: 18,
    lineHeight: 22,
    marginBottom: 8,
  },
  description: {
    fontSize: 15,
    lineHeight: 18,
    textAlign: "left",
    marginTop: "auto",
    marginBottom: "auto",
  },
  tabletDescription: {
    fontSize: 17,
    lineHeight: 24,
  },
});

export default DashboardTab;

import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import WordmarkDark from "@/assets/images/cyd-wordmark-dark.svg";
import WordmarkLight from "@/assets/images/cyd-wordmark.svg";
import { Colors, getThemePalette } from "@/constants/theme";
import type { AccountListItem } from "@/database/accounts";
import { useAccounts } from "@/hooks/use-accounts";
import { useColorScheme } from "@/hooks/use-color-scheme";

const CYD_DESKTOP_URL = "https://cyd.social/";
const TABLET_BREAKPOINT = 768;
const TABLET_CONTENT_MAX_WIDTH = 400;
const TABLET_CTA_MAX_WIDTH = 520;

export default function AccountSelectionScreen() {
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const palette = getThemePalette(colorScheme);
  const Wordmark = colorScheme === "dark" ? WordmarkDark : WordmarkLight;
  const { accounts, loading, error, refresh } = useAccounts();
  const router = useRouter();
  const isTablet = width >= TABLET_BREAKPOINT;
  const [navigatingAccountId, setNavigatingAccountId] = useState<string | null>(
    null,
  );

  useFocusEffect(
    useCallback(() => {
      setNavigatingAccountId(null);
    }, []),
  );

  const handleAddAccount = useCallback(() => {
    void router.push("/add-account");
  }, [router]);

  const handleSelectAccount = useCallback(
    (account: AccountListItem) => {
      if (navigatingAccountId) {
        return;
      }

      setNavigatingAccountId(account.uuid);
      router.push({
        pathname: "/account/[accountId]",
        params: { accountId: account.uuid },
      });
      console.log(
        "[AccountSelectionScreen] navigated to account",
        account.id,
        account.handle,
      );
    },
    [router, navigatingAccountId],
  );

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleOpenDesktop = useCallback(() => {
    void Linking.openURL(CYD_DESKTOP_URL).catch((err) =>
      console.warn("Unable to open URL", err),
    );
  }, []);

  const renderAccount = useCallback(
    ({ item }: { item: AccountListItem }) => (
      <AccountCard
        account={item}
        palette={palette}
        onSelect={handleSelectAccount}
        disabled={Boolean(navigatingAccountId)}
        busy={navigatingAccountId === item.uuid}
      />
    ),
    [palette, handleSelectAccount, navigatingAccountId],
  );

  const listEmpty = useMemo(() => {
    if (loading) {
      return (
        <View style={styles.emptyListContainer}>
          <ActivityIndicator size="small" color={palette.icon} />
        </View>
      );
    }

    if (error) {
      return (
        <Text style={[styles.emptyStateText, { color: palette.icon }]}>
          Unable to load accounts. Pull to refresh.
        </Text>
      );
    }

    return (
      <Text style={[styles.emptyStateText, { color: palette.icon }]}>
        Add a Bluesky account to get started.
      </Text>
    );
  }, [loading, error, palette.icon]);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: palette.background }]}
      edges={["top", "left", "right"]}
    >
      <View style={[styles.container, isTablet && styles.tabletContainer]}>
        {error ? (
          <View
            style={[
              styles.banner,
              isTablet && styles.tabletBanner,
              { backgroundColor: palette.icon + "22" },
            ]}
          >
            <Text style={[styles.bannerText, { color: palette.text }]}>
              Unable to load accounts. Pull to refresh.
            </Text>
          </View>
        ) : null}
        <View
          style={[styles.contentShell, isTablet && styles.tabletContentShell]}
        >
          <View
            style={[styles.mainContent, isTablet && styles.tabletMainContent]}
          >
            <View style={styles.listSection}>
              <View
                style={[
                  styles.wordmarkWrapper,
                  isTablet && styles.tabletWordmarkWrapper,
                ]}
              >
                <Wordmark
                  width="100%"
                  height={72}
                  preserveAspectRatio="xMidYMid meet"
                />
              </View>

              <FlatList
                data={accounts}
                keyExtractor={(item) => item.uuid}
                renderItem={renderAccount}
                ListEmptyComponent={listEmpty}
                showsVerticalScrollIndicator={false}
                style={styles.accountList}
                contentContainerStyle={
                  accounts.length === 0 ? styles.emptyListContainer : undefined
                }
                refreshControl={
                  <RefreshControl
                    refreshing={loading}
                    onRefresh={handleRefresh}
                    tintColor={palette.icon}
                  />
                }
              />
            </View>

            <Pressable
              onPress={handleAddAccount}
              style={({ pressed }) => [
                styles.addAccountButton,
                isTablet && styles.tabletAddAccountButton,
                {
                  backgroundColor: palette.button.background,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
              android_ripple={{ color: palette.button.ripple }}
            >
              <Text
                style={[
                  styles.addAccountButtonText,
                  { color: palette.button.text },
                ]}
              >
                Add Bluesky Account
              </Text>
            </Pressable>
          </View>

          <Text
            style={[
              styles.footerText,
              isTablet && styles.tabletFooterText,
              { color: palette.icon },
            ]}
            accessibilityRole="text"
          >
            Want to claw back your data from X (formerly Twitter)? Use the{" "}
            <Text
              style={[styles.footerLink, { color: palette.tint }]}
              onPress={handleOpenDesktop}
            >
              Cyd desktop app
            </Text>{" "}
            on a computer.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

type AccountCardProps = {
  account: AccountListItem;
  palette: typeof Colors.light;
  onSelect: (account: AccountListItem) => void;
  disabled?: boolean;
  busy?: boolean;
};

function AccountCard({
  account,
  palette,
  onSelect,
  disabled,
  busy,
}: AccountCardProps) {
  const avatarUri = account.avatarUrl || null;
  const username = account.handle.startsWith("@")
    ? account.handle
    : `@${account.handle}`;
  const displayName = account.displayName ?? username;
  const initial = displayName.replace(/^@/, "").charAt(0).toUpperCase() || "?";

  return (
    <Pressable
      onPress={() => onSelect(account)}
      disabled={disabled}
      style={({ pressed }) => [
        styles.accountCard,
        {
          borderColor: palette.icon + "22",
          backgroundColor: palette.card,
          opacity: disabled ? 0.6 : pressed ? 0.92 : 1,
        },
      ]}
      android_ripple={{ color: palette.icon + "33" }}
    >
      {avatarUri ? (
        <Image
          source={{ uri: avatarUri }}
          style={[
            styles.avatar,
            {
              borderColor: palette.icon + "33",
              backgroundColor: palette.icon + "20",
            },
          ]}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View
          style={[
            styles.avatarFallback,
            {
              borderColor: palette.icon + "33",
              backgroundColor: palette.icon + "20",
            },
          ]}
        >
          <Text style={[styles.avatarInitial, { color: palette.text }]}>
            {initial}
          </Text>
        </View>
      )}
      <View style={styles.accountTextStack}>
        <Text
          style={[styles.accountName, { color: palette.text }]}
          numberOfLines={1}
        >
          {displayName}
        </Text>
        <Text
          style={[styles.accountUsername, { color: palette.icon }]}
          numberOfLines={1}
        >
          {username}
        </Text>
      </View>
      {busy ? <ActivityIndicator size="small" color={palette.tint} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
    gap: 16,
  },
  tabletContainer: {
    alignItems: "center",
    paddingTop: 48,
    paddingBottom: 32,
  },
  contentShell: {
    flex: 1,
    width: "100%",
    gap: 16,
  },
  tabletContentShell: {
    maxWidth: TABLET_CONTENT_MAX_WIDTH,
  },
  mainContent: {
    flex: 1,
    gap: 20,
  },
  tabletMainContent: {
    paddingTop: 16,
    paddingBottom: 16,
  },
  listSection: {
    flex: 1,
    minHeight: 0,
  },
  wordmarkWrapper: {
    alignItems: "center",
    alignSelf: "center",
    marginBottom: 20,
    width: 160,
  },
  tabletWordmarkWrapper: {
    alignItems: "center",
    alignSelf: "center",
    width: 180,
    marginBottom: 24,
  },
  accountList: {
    flex: 1,
  },
  accountCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
    gap: 16,
  },
  accountTextStack: {
    flex: 1,
  },
  accountName: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 2,
  },
  accountUsername: {
    fontSize: 14,
    opacity: 0.9,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontSize: 16,
    fontWeight: "700",
  },
  addAccountButton: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  tabletAddAccountButton: {
    width: "100%",
    maxWidth: TABLET_CTA_MAX_WIDTH,
    alignSelf: "center",
  },
  addAccountButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  footerText: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  tabletFooterText: {
    width: "100%",
    maxWidth: TABLET_CTA_MAX_WIDTH,
    alignSelf: "center",
  },
  footerLink: {
    fontWeight: "600",
  },
  emptyStateText: {
    textAlign: "center",
    fontSize: 14,
    paddingVertical: 24,
  },
  emptyListContainer: {
    flexGrow: 1,
    justifyContent: "center",
  },
  banner: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  tabletBanner: {
    width: "100%",
  },
  bannerText: {
    fontSize: 13,
  },
});

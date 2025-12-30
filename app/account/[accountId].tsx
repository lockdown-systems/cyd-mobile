import { MaterialIcons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ComponentType,
} from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { AccountSettingsSheet } from "@/components/account/AccountSettingsSheet";
import { Colors } from "@/constants/theme";
import {
  ACCOUNT_AUTH_STATUS,
  ACCOUNT_CONFIG_KEYS,
  BlueskyAccountController,
  type AccountAuthStatusValue,
} from "@/controllers";
import { useAccounts } from "@/hooks/use-accounts";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { verifyBlueskyAccountAuthStatus } from "@/services/bluesky-account-auth-status";
import { revokeBlueskyAuthorization } from "@/services/bluesky-oauth";
import type { AccountTabKey, AccountTabProps } from "@/types/account-tabs";
import { BrowseTab } from "./tabs/browse-tab";
import { DashboardTab } from "./tabs/dashboard-tab";
import { DeleteTab } from "./tabs/delete-tab";
import { SaveTab } from "./tabs/save-tab";

export default function AccountPlaceholderScreen() {
  const params = useLocalSearchParams<{ accountId: string | string[] }>();
  const accountId = Array.isArray(params.accountId)
    ? params.accountId[0]
    : params.accountId;
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const { accounts, loading, error } = useAccounts();
  const account = useMemo(
    () => accounts.find((item) => item.uuid === accountId),
    [accounts, accountId]
  );
  const [activeTab, setActiveTab] = useState<AccountTabKey>("dashboard");
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [authStatus, setAuthStatus] = useState<
    AccountAuthStatusValue | "unknown"
  >("unknown");
  const insets = useSafeAreaInsets();
  const handleSelectTab = useCallback((tab: AccountTabKey) => {
    setActiveTab(tab);
  }, []);
  const openSettings = useCallback(() => {
    setSettingsVisible(true);
  }, []);
  const closeSettings = useCallback(() => {
    setSettingsVisible(false);
  }, []);
  const handleSignOut = useCallback(async () => {
    if (!account) {
      throw new Error(
        "Account information is not available yet. Please try again in a moment."
      );
    }

    const controller = new BlueskyAccountController(account.id, account.uuid);

    try {
      await controller.initDB();
      await revokeBlueskyAuthorization(account.id);
      const nextStatus = await verifyBlueskyAccountAuthStatus(
        controller,
        account
      );
      setAuthStatus(nextStatus);
    } catch (err) {
      throw err instanceof Error
        ? err
        : new Error("Unable to sign out of Bluesky right now.");
    } finally {
      try {
        await controller.cleanup();
      } catch (cleanupErr) {
        console.warn(
          "Failed to cleanup controller after signing out",
          cleanupErr
        );
      }
    }
  }, [account]);

  useEffect(() => {
    if (!account) {
      setAuthStatus("unknown");
      return;
    }

    let cancelled = false;
    const controller = new BlueskyAccountController(account.id, account.uuid);

    void (async () => {
      try {
        await controller.initDB();
        const storedStatus = await controller.getConfig(
          ACCOUNT_CONFIG_KEYS.authStatus
        );
        if (!cancelled) {
          if (storedStatus === ACCOUNT_AUTH_STATUS.authenticated) {
            setAuthStatus(ACCOUNT_AUTH_STATUS.authenticated);
          } else if (storedStatus === ACCOUNT_AUTH_STATUS.signedOut) {
            setAuthStatus(ACCOUNT_AUTH_STATUS.signedOut);
          } else {
            setAuthStatus("unknown");
          }
        }
      } catch (err) {
        console.warn("Unable to read account auth status", err);
        if (!cancelled) {
          setAuthStatus(ACCOUNT_AUTH_STATUS.signedOut);
        }
      } finally {
        try {
          await controller.cleanup();
        } catch (cleanupErr) {
          console.warn(
            "Failed to cleanup controller after reading status",
            cleanupErr
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account]);

  const avatarUri = account?.avatarDataURI ?? null;
  const username = account?.handle
    ? account.handle.startsWith("@")
      ? account.handle
      : `@${account.handle}`
    : null;
  const displayName = account?.displayName ?? username ?? "Unknown";
  const initial = displayName.replace(/^@/, "").charAt(0).toUpperCase() || "?";
  const accountStatus = error
    ? "Unable to load account"
    : loading
      ? "Loading account…"
      : account
        ? null
        : "Account not found";
  const canonicalHandle = username ?? account?.handle ?? accountId ?? "unknown";
  const ActiveTabComponent = TAB_COMPONENTS[activeTab];
  const isSignedOut = authStatus === ACCOUNT_AUTH_STATUS.signedOut;
  const statusIconColor = palette.warning ?? Colors.light.warning;

  return (
    <>
      <SafeAreaView
        edges={["left", "right"]}
        style={[styles.safeArea, { backgroundColor: palette.background }]}
      >
        <Stack.Screen
          options={{
            headerStyle: { backgroundColor: palette.background },
            headerTintColor: palette.text,
            headerShadowVisible: false,
            headerBackTitle: "Back",
            headerTitle: () => (
              <View style={styles.headerTitle}>
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
                    <Text
                      style={[styles.avatarInitial, { color: palette.text }]}
                    >
                      {initial}
                    </Text>
                  </View>
                )}
                <View style={styles.headerTextStack}>
                  <View style={styles.accountNameRow}>
                    <Text
                      style={[styles.accountName, { color: palette.text }]}
                      numberOfLines={1}
                    >
                      {displayName}
                    </Text>
                    {isSignedOut ? (
                      <MaterialIcons
                        name="error-outline"
                        size={18}
                        color={statusIconColor}
                        accessibilityLabel="Signed out of Bluesky"
                      />
                    ) : null}
                  </View>
                  <Text
                    style={[styles.accountUsername, { color: palette.icon }]}
                    numberOfLines={1}
                  >
                    {username ?? ""}
                  </Text>
                </View>
              </View>
            ),
            headerRight: () => (
              <Pressable
                onPress={openSettings}
                style={({ pressed }) => [
                  styles.headerActionButton,
                  {
                    borderColor: palette.icon + "33",
                    backgroundColor: palette.card,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Account settings"
              >
                <MaterialIcons name="settings" size={20} color={palette.text} />
              </Pressable>
            ),
          }}
        />
        <View style={styles.container}>
          <View style={styles.contentArea}>
            {accountStatus ? (
              <View style={styles.statusContainer}>
                <Text style={[styles.subtitle, { color: palette.icon }]}>
                  {accountStatus}
                </Text>
              </View>
            ) : account ? (
              <ActiveTabComponent
                accountId={account.id}
                handle={canonicalHandle}
                palette={palette}
                onSelectTab={handleSelectTab}
              />
            ) : null}
          </View>
          <View
            style={[styles.tabBarContainer, { paddingBottom: insets.bottom }]}
          >
            <View
              style={[
                styles.tabBar,
                {
                  borderColor: palette.icon + "22",
                  backgroundColor: palette.card,
                },
              ]}
            >
              {TAB_CONFIG.map((tab) => {
                const selected = tab.key === activeTab;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => handleSelectTab(tab.key)}
                    style={[
                      styles.tabButton,
                      selected && { backgroundColor: palette.icon + "11" },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <MaterialIcons
                      name={tab.icon}
                      size={20}
                      color={selected ? palette.tint : palette.icon}
                    />
                    <Text
                      style={[
                        styles.tabLabel,
                        { color: selected ? palette.tint : palette.icon },
                      ]}
                    >
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </SafeAreaView>
      <AccountSettingsSheet
        handle={canonicalHandle}
        palette={palette}
        visible={settingsVisible}
        onClose={closeSettings}
        bottomInset={insets.bottom}
        onSignOut={handleSignOut}
      />
    </>
  );
}

type TabConfig = {
  key: AccountTabKey;
  label: string;
  icon: ComponentProps<typeof MaterialIcons>["name"];
};

const TAB_CONFIG: TabConfig[] = [
  { key: "dashboard", label: "Dashboard", icon: "home" },
  { key: "save", label: "Save", icon: "download" },
  { key: "delete", label: "Delete", icon: "local-fire-department" },
  { key: "browse", label: "Browse", icon: "preview" },
];

const TAB_COMPONENTS: Record<AccountTabKey, ComponentType<AccountTabProps>> = {
  dashboard: DashboardTab,
  save: SaveTab,
  delete: DeleteTab,
  browse: BrowseTab,
};
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    paddingTop: 20,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 0,
    paddingBottom: 0,
    gap: 4,
  },
  contentArea: {
    flex: 1,
  },
  headerTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    maxWidth: 260,
  },
  headerTextStack: {
    flex: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontSize: 16,
    fontWeight: "700",
  },
  accountName: {
    fontSize: 16,
    fontWeight: "700",
  },
  accountNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  accountUsername: {
    fontSize: 14,
    opacity: 0.9,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
  },
  statusContainer: {
    flex: 1,
    justifyContent: "center",
  },
  tabBar: {
    flexDirection: "row",
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 4,
  },
  tabBarContainer: {
    paddingTop: 8,
    paddingBottom: 0,
    marginTop: "auto",
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    gap: 4,
    borderRadius: 16,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  headerActionButton: {
    padding: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
});

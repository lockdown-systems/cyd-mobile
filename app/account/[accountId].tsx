import { MaterialIcons } from "@expo/vector-icons";
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ComponentType,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { AccountMenuSheet } from "@/app/account/components/AccountMenuSheet";

import { Colors } from "@/constants/theme";
import {
  ACCOUNT_AUTH_STATUS,
  ACCOUNT_CONFIG_KEYS,
  BlueskyAccountController,
  type AccountAuthStatusValue,
} from "@/controllers";
import { deleteAccount, type AccountListItem } from "@/database/accounts";
import { useAccounts } from "@/hooks/use-accounts";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { verifyBlueskyAccountAuthStatus } from "@/services/bluesky-account-auth-status";
import {
  authenticateBlueskyAccount,
  revokeBlueskyAuthorization,
} from "@/services/bluesky-oauth";
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
  const router = useRouter();
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
  const [statusActionPending, setStatusActionPending] = useState(false);
  const [verifyingAuth, setVerifyingAuth] = useState(false);
  const insets = useSafeAreaInsets();
  const handleSelectTab = useCallback((tab: AccountTabKey) => {
    console.log("[AccountScreen] select tab", tab);
    setActiveTab(tab);
  }, []);
  const openSettings = useCallback(() => {
    console.log("[AccountScreen] open settings");
    setSettingsVisible(true);
  }, []);
  const closeSettings = useCallback(() => {
    console.log("[AccountScreen] close settings");
    setSettingsVisible(false);
  }, []);
  const handleSignOut = useCallback(async () => {
    if (!account) {
      throw new Error(
        "Account information is not available yet. Please try again in a moment."
      );
    }

    try {
      console.log("[AccountScreen] handleSignOut -> start", account.id);
      await revokeBlueskyAuthorization(account.id);
      console.log(
        "[AccountScreen] revokeBlueskyAuthorization complete",
        account.id
      );
      setAuthStatus(ACCOUNT_AUTH_STATUS.signedOut);
      const nextStatus = await runWithAccountController(account, (controller) =>
        verifyBlueskyAccountAuthStatus(controller, account)
      );
      console.log(
        "[AccountScreen] handleSignOut -> verified",
        account.id,
        nextStatus
      );
      setAuthStatus(nextStatus);
    } catch (err) {
      console.warn("[AccountScreen] handleSignOut -> error", account?.id, err);
      throw err instanceof Error
        ? err
        : new Error("Unable to sign out of Bluesky right now.");
    }
  }, [account]);

  const handleReauthenticate = useCallback(async () => {
    if (!account) {
      throw new Error(
        "Account information is not available yet. Please try again in a moment."
      );
    }

    try {
      console.log("[AccountScreen] handleReauthenticate -> start", account.id);
      await authenticateBlueskyAccount(account.handle);
      console.log(
        "[AccountScreen] authenticateBlueskyAccount -> success",
        account.id
      );
      const nextStatus = await runWithAccountController(account, (controller) =>
        verifyBlueskyAccountAuthStatus(controller, account, { force: true })
      );
      console.log(
        "[AccountScreen] handleReauthenticate -> verified",
        account.id,
        nextStatus
      );
      setAuthStatus(nextStatus);
    } catch (err) {
      console.warn(
        "[AccountScreen] handleReauthenticate -> error",
        account?.id,
        err
      );
      throw err instanceof Error
        ? err
        : new Error("Unable to reauthenticate with Bluesky right now.");
    }
  }, [account]);

  const handleRemoveAccount = useCallback(async () => {
    if (!account) {
      throw new Error(
        "Account information is not available yet. Please try again in a moment."
      );
    }

    await handleSignOut();

    try {
      const controller = new BlueskyAccountController(account.id, account.uuid);
      await controller.deleteAccountStorage();
    } catch (err) {
      console.warn("Failed to delete account storage", err);
      throw err instanceof Error
        ? err
        : new Error("Unable to delete account data from this device.");
    }

    try {
      await deleteAccount(account.id);
    } catch (err) {
      console.warn("Failed to delete account record", err);
      throw err instanceof Error
        ? err
        : new Error("Unable to delete this account right now.");
    }

    router.replace("/");
  }, [account, handleSignOut, router]);

  useEffect(() => {
    if (!account) {
      setAuthStatus("unknown");
      setVerifyingAuth(false);
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
        console.log(
          "[AccountScreen] useEffect -> stored status",
          account.id,
          storedStatus
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
          console.log("[AccountScreen] useEffect -> cleanup", account.id);
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

  useFocusEffect(
    useCallback(() => {
      if (!account) {
        setVerifyingAuth(false);
        setAuthStatus("unknown");
        return undefined;
      }

      let cancelled = false;
      setVerifyingAuth(true);

      void (async () => {
        try {
          const nextStatus = await runWithAccountController(
            account,
            (controller) => verifyBlueskyAccountAuthStatus(controller, account)
          );
          if (!cancelled) {
            setAuthStatus(nextStatus);
          }
        } catch (err) {
          console.warn("[AccountScreen] verify auth -> error", account.id, err);
          if (!cancelled) {
            setAuthStatus(ACCOUNT_AUTH_STATUS.signedOut);
          }
        } finally {
          if (!cancelled) {
            setVerifyingAuth(false);
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [account])
  );

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
      : !account
        ? "Account not found"
        : null;
  const canonicalHandle = username ?? account?.handle ?? accountId ?? "unknown";
  const ActiveTabComponent = TAB_COMPONENTS[activeTab];
  const showWarning = authStatus !== ACCOUNT_AUTH_STATUS.authenticated;
  const statusIconColor = showWarning
    ? (palette.warning ?? Colors.light.warning)
    : palette.tint;
  const statusIconDisabled =
    (showWarning && statusActionPending) || verifyingAuth;
  const handleStatusIconPress = useCallback(() => {
    if (showWarning) {
      if (statusActionPending) {
        return;
      }
      setStatusActionPending(true);
      void (async () => {
        try {
          await handleReauthenticate();
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Unable to reauthenticate with Bluesky right now.";
          Alert.alert("Reauthentication failed", message);
        } finally {
          setStatusActionPending(false);
        }
      })();
      return;
    }

    Alert.alert(
      "Authenticated with Bluesky",
      "Cyd is currently authorized to control your Bluesky account."
    );
  }, [handleReauthenticate, showWarning, statusActionPending]);

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
                    <Pressable
                      onPress={handleStatusIconPress}
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.statusIconButton,
                        pressed && !statusIconDisabled && { opacity: 0.8 },
                        statusIconDisabled && styles.statusIconDisabled,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={
                        showWarning
                          ? "Signed out of Bluesky"
                          : "Authenticated with Bluesky"
                      }
                      accessibilityHint={
                        showWarning
                          ? "Double tap to reauthenticate with Bluesky."
                          : "Double tap to confirm your Bluesky connection."
                      }
                      accessibilityState={{ busy: statusIconDisabled }}
                      disabled={statusIconDisabled}
                    >
                      {verifyingAuth ? (
                        <ActivityIndicator size="small" color={palette.icon} />
                      ) : (
                        <MaterialIcons
                          name={showWarning ? "error-outline" : "check-circle"}
                          size={18}
                          color={statusIconColor}
                        />
                      )}
                    </Pressable>
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
                    opacity: pressed ? 0.5 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Account menu"
              >
                <MaterialIcons name="menu" size={20} color={palette.text} />
              </Pressable>
            ),
          }}
        />
        <View style={styles.container}>
          <View style={styles.contentArea}>
            {accountStatus ? (
              <View style={styles.statusContainer}>
                {loading && (
                  <ActivityIndicator
                    size="small"
                    color={palette.icon}
                    style={{ marginBottom: 8 }}
                  />
                )}
                <Text style={[styles.subtitle, { color: palette.icon }]}>
                  {accountStatus}
                </Text>
              </View>
            ) : null}
            {account ? (
              <ActiveTabComponent
                accountId={account.id}
                accountUUID={account.uuid}
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
      <AccountMenuSheet
        handle={canonicalHandle}
        palette={palette}
        visible={settingsVisible}
        onClose={closeSettings}
        bottomInset={insets.bottom}
        authStatus={authStatus === "unknown" ? "unknown" : authStatus}
        onReauthenticate={handleReauthenticate}
        onSignOut={handleSignOut}
        onRemoveAccount={handleRemoveAccount}
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

async function runWithAccountController<T>(
  account: AccountListItem,
  fn: (controller: BlueskyAccountController) => Promise<T>
): Promise<T> {
  console.log("[AccountScreen] runWithAccountController -> start", account.id);
  const controller = new BlueskyAccountController(account.id, account.uuid);
  try {
    await controller.initDB();
    console.log(
      "[AccountScreen] runWithAccountController -> initDB",
      account.id
    );
    return await fn(controller);
  } finally {
    try {
      await controller.cleanup();
      console.log(
        "[AccountScreen] runWithAccountController -> cleanup",
        account.id
      );
    } catch (cleanupErr) {
      console.warn("Failed to cleanup controller", cleanupErr);
    }
  }
}

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
  statusIconButton: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  statusIconDisabled: {
    opacity: 0.5,
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
  },
});

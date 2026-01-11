import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import WordmarkDark from "@/assets/images/cyd-wordmark-dark.svg";
import WordmarkLight from "@/assets/images/cyd-wordmark.svg";
import { CydAccountBar } from "@/components/CydAccountBar";
import { Colors } from "@/constants/theme";
import type { AccountListItem } from "@/database/accounts";
import { useAccounts } from "@/hooks/use-accounts";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  cleanupTempDir,
  importArchive,
  pickArchiveFile,
  validateArchive,
  validateArchiveFilename,
} from "@/services/archive-import";

const CYD_DESKTOP_URL = "https://cyd.social/";

export default function AccountSelectionScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const Wordmark = colorScheme === "dark" ? WordmarkDark : WordmarkLight;
  const { accounts, loading, error, refresh } = useAccounts();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [navigatingAccountId, setNavigatingAccountId] = useState<string | null>(
    null
  );
  const [isImporting, setIsImporting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setNavigatingAccountId(null);
    }, [])
  );

  const handleAddAccount = useCallback(() => {
    void router.push("/add-account");
  }, [router]);

  const handleImportArchive = useCallback(async () => {
    if (isImporting) return;

    try {
      // Pick a zip file
      const pickedFile = await pickArchiveFile();
      if (!pickedFile) {
        return; // User cancelled
      }

      // Validate the filename
      const filenameValidation = validateArchiveFilename(pickedFile.filename);
      if (!filenameValidation.valid) {
        Alert.alert("Import Failed", filenameValidation.error);
        return;
      }

      setIsImporting(true);

      // Validate the archive
      const validation = await validateArchive(pickedFile.uri);

      if (!validation.valid) {
        if (validation.tempDir) {
          cleanupTempDir(validation.tempDir);
        }
        Alert.alert("Import Failed", validation.error);
        return;
      }

      // Import the archive
      const result = await importArchive(
        validation.metadata,
        validation.tempDir
      );

      // Clean up temp directory
      cleanupTempDir(validation.tempDir);

      if (!result.success) {
        Alert.alert("Import Failed", result.error);
        return;
      }

      // Refresh the accounts list
      await refresh();

      Alert.alert(
        "Import Successful",
        `Successfully imported archive for @${validation.metadata.account.handle}.`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert("Import Failed", message);
    } finally {
      setIsImporting(false);
    }
  }, [isImporting, refresh]);

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
        account.handle
      );
    },
    [router, navigatingAccountId]
  );

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleOpenDesktop = useCallback(() => {
    void Linking.openURL(CYD_DESKTOP_URL).catch((err) =>
      console.warn("Unable to open URL", err)
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
    [palette, handleSelectAccount, navigatingAccountId]
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
      <View style={styles.container}>
        {error ? (
          <View
            style={[styles.banner, { backgroundColor: palette.icon + "22" }]}
          >
            <Text style={[styles.bannerText, { color: palette.text }]}>
              Unable to load accounts. Pull to refresh.
            </Text>
          </View>
        ) : null}
        <View style={styles.mainContent}>
          <View style={styles.wordmarkWrapper}>
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

          <Pressable
            onPress={handleAddAccount}
            style={({ pressed }) => [
              styles.addAccountButton,
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
          style={[styles.footerText, { color: palette.icon }]}
          accessibilityRole="text"
        >
          Want to claw back your data from X (formerly Twitter) and Facebook?
          Use the{" "}
          <Text
            style={[styles.footerLink, { color: palette.tint }]}
            onPress={handleOpenDesktop}
          >
            Cyd desktop app
          </Text>{" "}
          on a computer.
        </Text>
      </View>

      <CydAccountBar
        bottomInset={insets.bottom}
        onImportArchive={() => void handleImportArchive()}
      />

      <Modal
        visible={isImporting}
        transparent
        animationType="fade"
        statusBarTranslucent
      >
        <View style={styles.loadingOverlay}>
          <View
            style={[
              styles.loadingContainer,
              { backgroundColor: palette.background },
            ]}
          >
            <ActivityIndicator size="large" color={palette.tint} />
            <Text style={[styles.loadingText, { color: palette.text }]}>
              Importing archive...
            </Text>
          </View>
        </View>
      </Modal>
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
  mainContent: {
    flex: 1,
    gap: 20,
  },
  wordmarkWrapper: {
    alignItems: "flex-start",
    marginBottom: 20,
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
  addAccountButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  loadingOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingContainer: {
    padding: 24,
    borderRadius: 16,
    alignItems: "center",
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: "500",
  },
  footerText: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
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
  bannerText: {
    fontSize: 13,
  },
});

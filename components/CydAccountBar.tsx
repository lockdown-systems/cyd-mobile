import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getThemePalette } from "@/constants/theme";
import { useCydAccount } from "@/contexts/CydAccountProvider";
import { useBlueskyArchiveImport } from "@/hooks/use-bluesky-archive-import";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { emitLocalAccountsChanged } from "@/services/account-events";
import { connectBlueskyAccount } from "@/services/bluesky-sign-in";
import { createScheduledReminderSync } from "@/services/scheduled-reminder-sync";

import { BlueskyArchiveImportModal } from "./BlueskyArchiveImportModal";
import { CydSignInModal } from "./CydSignInModal";

type CydAccountBarProps = {
  onShowOnboarding?: () => void;
  hidden?: boolean;
};

export function CydAccountBar({
  onShowOnboarding,
  hidden,
}: CydAccountBarProps) {
  const insets = useSafeAreaInsets();
  const bottomInset = insets.bottom;
  const barBottomPadding =
    Platform.OS === "android" ? Math.max(bottomInset, 8) : bottomInset;
  const colorScheme = useColorScheme();
  const palette = getThemePalette(colorScheme);
  const { state, signOut, getDashboardURL, apiClient } = useCydAccount();

  const [menuVisible, setMenuVisible] = useState(false);
  const [signInModalVisible, setSignInModalVisible] = useState(false);
  const archiveImport = useBlueskyArchiveImport({
    // Reconciling duplicate accounts can retire a local-account UUID the
    // server schedules reminders against (ADR 0005), so the import tells it.
    reminders: useMemo(
      () => createScheduledReminderSync(apiClient, state.isSignedIn),
      [apiClient, state.isSignedIn],
    ),
  });

  const handleMenuPress = useCallback(() => {
    setMenuVisible(true);
  }, []);

  const handleCloseMenu = useCallback(() => {
    setMenuVisible(false);
  }, []);

  const handleSignInPress = useCallback(() => {
    setMenuVisible(false);
    setSignInModalVisible(true);
  }, []);

  const handleCloseSignInModal = useCallback(() => {
    setSignInModalVisible(false);
  }, []);

  const handleManageAccount = useCallback(() => {
    setMenuVisible(false);
    const dashboardURL = getDashboardURL();
    void Linking.openURL(dashboardURL).catch((err) =>
      console.warn("Unable to open dashboard URL:", err),
    );
  }, [getDashboardURL]);

  const handleSignOut = useCallback(() => {
    setMenuVisible(false);
    void signOut();
  }, [signOut]);

  const handleShowOnboarding = useCallback(() => {
    setMenuVisible(false);
    onShowOnboarding?.();
  }, [onShowOnboarding]);

  /**
   * Import a Cyd Bluesky archive.
   *
   * Importing needs no Cyd account and no premium subscription — it is how
   * somebody gets their own data back — so the menu item is here whether or
   * not they are signed in. Where the archive lands is decided by the Bluesky
   * identity inside it, not by anything about the file (#97).
   */
  const handleImportArchive = useCallback(() => {
    setMenuVisible(false);
    void archiveImport.start();
  }, [archiveImport]);

  /**
   * Connect the Bluesky account an import just restored.
   *
   * A restored Bluesky local account holds somebody's data and no authorization
   * to act on it, because a Cyd Bluesky archive never carries a Bluesky
   * connection. Offering the sign-in here is offering it at the one moment the
   * person is already thinking about that account — and signing in is also what
   * fills in the display name and avatar an archive cannot carry.
   *
   * The import is dismissed first: the OAuth session is a full-screen browser,
   * and it should not open over a modal reporting an import that has finished.
   */
  const handleSignIn = useCallback(
    (handle: string) => {
      archiveImport.dismiss();
      void (async () => {
        try {
          await connectBlueskyAccount(handle);
          emitLocalAccountsChanged();
        } catch (err) {
          Alert.alert(
            "Sign in failed",
            err instanceof Error
              ? err.message
              : "Cyd could not connect to Bluesky right now.",
          );
        }
      })();
    },
    [archiveImport],
  );

  if (state.isLoading || hidden) {
    return null;
  }

  return (
    <>
      <View
        style={[
          styles.container,
          {
            backgroundColor: palette.card,
            borderTopColor: palette.icon + "22",
            paddingBottom: barBottomPadding,
          },
        ]}
      >
        <View style={styles.content}>
          <Text
            style={[styles.statusText, { color: palette.icon }]}
            numberOfLines={1}
          >
            {state.isSignedIn
              ? `Signed in as ${state.userEmail}`
              : "Not signed in to Cyd"}
          </Text>

          <Pressable
            onPress={handleMenuPress}
            style={({ pressed }) => [
              styles.menuButton,
              {
                backgroundColor: pressed ? palette.icon + "15" : "transparent",
              },
            ]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.menuIcon, { color: palette.icon }]}>☰</Text>
          </Pressable>
        </View>
      </View>

      {/* Menu Modal - Bottom Sheet Style */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        onRequestClose={handleCloseMenu}
        statusBarTranslucent
      >
        <View style={styles.sheetOverlay}>
          <Pressable
            style={styles.sheetDismissArea}
            onPress={handleCloseMenu}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: palette.card,
                paddingBottom: bottomInset + 16,
              },
            ]}
          >
            <View
              style={[styles.grabber, { backgroundColor: palette.icon + "44" }]}
            />
            {state.isSignedIn ? (
              <>
                <Text
                  style={[styles.sheetEmailText, { color: palette.icon }]}
                  numberOfLines={1}
                >
                  Signed in as {state.userEmail}
                </Text>
                <Pressable
                  onPress={handleManageAccount}
                  style={({ pressed }) => [
                    styles.sheetActionButton,
                    {
                      borderColor: palette.icon + "22",
                      backgroundColor: palette.background,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                >
                  <Text
                    style={[styles.sheetActionText, { color: palette.text }]}
                  >
                    Manage my Cyd account
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleSignOut}
                  style={({ pressed }) => [
                    styles.sheetActionButton,
                    {
                      borderColor: palette.icon + "22",
                      backgroundColor: palette.background,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                >
                  <Text
                    style={[styles.sheetActionText, { color: palette.text }]}
                  >
                    Sign out of Cyd account
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  onPress={handleSignInPress}
                  style={({ pressed }) => [
                    styles.sheetActionButton,
                    {
                      borderColor: palette.icon + "22",
                      backgroundColor: palette.background,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                >
                  <Text
                    style={[styles.sheetActionText, { color: palette.text }]}
                  >
                    Sign in to Cyd to access premium features
                  </Text>
                </Pressable>
              </>
            )}
            <View
              style={[
                styles.sheetSeparator,
                { borderColor: palette.icon + "22" },
              ]}
            />
            <Pressable
              onPress={handleImportArchive}
              style={({ pressed }) => [
                styles.sheetActionButton,
                {
                  borderColor: palette.icon + "22",
                  backgroundColor: palette.background,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
              accessibilityRole="button"
            >
              <Text style={[styles.sheetActionText, { color: palette.text }]}>
                Import Bluesky archive
              </Text>
            </Pressable>
            <Pressable
              onPress={handleShowOnboarding}
              style={({ pressed }) => [
                styles.sheetActionButton,
                {
                  borderColor: palette.icon + "22",
                  backgroundColor: palette.background,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
              accessibilityRole="button"
            >
              <Text style={[styles.sheetActionText, { color: palette.text }]}>
                Show Cyd onboarding
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Sign In Modal */}
      <CydSignInModal
        visible={signInModalVisible}
        onClose={handleCloseSignInModal}
      />

      <BlueskyArchiveImportModal
        state={archiveImport.state}
        onConfirmLargeArchive={() => void archiveImport.confirmLargeArchive()}
        onConfirmMerge={() => void archiveImport.confirmMerge()}
        onKeepAccount={(choice) => void archiveImport.keepAccount(choice)}
        onSignIn={handleSignIn}
        onCancel={archiveImport.cancel}
        onDismiss={archiveImport.dismiss}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 0,
  },
  statusText: {
    flex: 1,
    fontSize: 13,
    marginRight: 12,
  },
  menuButton: {
    padding: 8,
    borderRadius: 8,
  },
  menuIcon: {
    fontSize: 18,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheetDismissArea: {
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
  },
  grabber: {
    width: 48,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
  },
  sheetEmailText: {
    fontSize: 13,
    textAlign: "center",
    marginBottom: 4,
  },
  sheetActionButton: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  sheetActionText: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  sheetSeparator: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
});

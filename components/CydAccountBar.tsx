import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors } from "@/constants/theme";
import { useCydAccount } from "@/contexts/CydAccountProvider";
import { useAccounts } from "@/hooks/use-accounts";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  cleanupTempDir,
  importArchive,
  pickArchiveFile,
  validateArchive,
  validateArchiveFilename,
} from "@/services/archive-import";

import { CydSignInModal } from "./CydSignInModal";

export function CydAccountBar() {
  const insets = useSafeAreaInsets();
  const bottomInset = insets.bottom;
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const { state, signOut, getDashboardURL } = useCydAccount();
  const { refresh } = useAccounts();

  const [menuVisible, setMenuVisible] = useState(false);
  const [signInModalVisible, setSignInModalVisible] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

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

  const handleImportBlueskyAccount = useCallback(async () => {
    if (isImporting) return;
    setMenuVisible(false);

    // Delay to allow the modal to fully close before opening the document picker
    await new Promise((resolve) => setTimeout(resolve, 50));

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
        validation.tempDir,
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
        `Successfully imported archive for @${validation.metadata.account.handle}.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert("Import Failed", message);
    } finally {
      setIsImporting(false);
    }
  }, [isImporting, refresh]);

  if (state.isLoading) {
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
            paddingBottom: 8,
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
                <View
                  style={[
                    styles.sheetSeparator,
                    { borderColor: palette.icon + "22" },
                  ]}
                />
                <Pressable
                  onPress={() => void handleImportBlueskyAccount()}
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
                    Import Bluesky archive
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
                <Pressable
                  onPress={() => void handleImportBlueskyAccount()}
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
                    Import Bluesky archive
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Sign In Modal */}
      <CydSignInModal
        visible={signInModalVisible}
        onClose={handleCloseSignInModal}
      />

      {/* Importing Modal */}
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
    paddingVertical: 12,
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
});

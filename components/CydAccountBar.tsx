import { useCallback, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Colors } from "@/constants/theme";
import { useCydAccount } from "@/contexts/CydAccountProvider";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { CydSignInModal } from "./CydSignInModal";

type CydAccountBarProps = {
  bottomInset?: number;
};

export function CydAccountBar({ bottomInset = 0 }: CydAccountBarProps) {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const { state, signOut, getDashboardURL } = useCydAccount();

  const [menuVisible, setMenuVisible] = useState(false);
  const [signInModalVisible, setSignInModalVisible] = useState(false);

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
      console.warn("Unable to open dashboard URL:", err)
    );
  }, [getDashboardURL]);

  const handleSignOut = useCallback(() => {
    setMenuVisible(false);
    void signOut();
  }, [signOut]);

  const handleImportBlueskyAccount = useCallback(() => {
    setMenuVisible(false);
    Alert.alert(
      "Not Implemented",
      "Import Bluesky archive is not yet implemented.",
      [{ text: "OK" }]
    );
  }, []);

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
            paddingBottom: bottomInset,
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
                  {state.userEmail}
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
                  onPress={handleImportBlueskyAccount}
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
                <View
                  style={[
                    styles.sheetSeparator,
                    { borderColor: palette.icon + "22" },
                  ]}
                />
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
                    Sign out
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
                  onPress={handleImportBlueskyAccount}
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
});

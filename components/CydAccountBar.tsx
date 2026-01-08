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
      "Import Bluesky account from file is not yet implemented.",
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

      {/* Menu Modal */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseMenu}
      >
        <Pressable style={styles.modalOverlay} onPress={handleCloseMenu}>
          <View
            style={[
              styles.menuContainer,
              {
                backgroundColor: palette.card,
                borderColor: palette.icon + "22",
              },
            ]}
          >
            {state.isSignedIn ? (
              <>
                <Text
                  style={[styles.menuEmailText, { color: palette.text }]}
                  numberOfLines={1}
                >
                  {state.userEmail}
                </Text>
                <View
                  style={[
                    styles.menuDivider,
                    { backgroundColor: palette.icon + "22" },
                  ]}
                />
                <Pressable
                  onPress={handleManageAccount}
                  style={({ pressed }) => [
                    styles.menuItem,
                    {
                      backgroundColor: pressed
                        ? palette.icon + "15"
                        : "transparent",
                    },
                  ]}
                >
                  <Text style={[styles.menuItemText, { color: palette.text }]}>
                    Manage my Cyd account
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleImportBlueskyAccount}
                  style={({ pressed }) => [
                    styles.menuItem,
                    {
                      backgroundColor: pressed
                        ? palette.icon + "15"
                        : "transparent",
                    },
                  ]}
                >
                  <Text style={[styles.menuItemText, { color: palette.text }]}>
                    Import Bluesky account from file
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleSignOut}
                  style={({ pressed }) => [
                    styles.menuItem,
                    {
                      backgroundColor: pressed
                        ? palette.icon + "15"
                        : "transparent",
                    },
                  ]}
                >
                  <Text style={[styles.menuItemText, { color: palette.text }]}>
                    Sign out
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  onPress={handleSignInPress}
                  style={({ pressed }) => [
                    styles.menuItem,
                    {
                      backgroundColor: pressed
                        ? palette.icon + "15"
                        : "transparent",
                    },
                  ]}
                >
                  <Text style={[styles.menuItemText, { color: palette.text }]}>
                    Sign in to Cyd to access premium features
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleImportBlueskyAccount}
                  style={({ pressed }) => [
                    styles.menuItem,
                    {
                      backgroundColor: pressed
                        ? palette.icon + "15"
                        : "transparent",
                    },
                  ]}
                >
                  <Text style={[styles.menuItemText, { color: palette.text }]}>
                    Import Bluesky account from file
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </Pressable>
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 100,
  },
  menuContainer: {
    width: "90%",
    maxWidth: 320,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  menuEmailText: {
    fontSize: 13,
    fontWeight: "500",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
  },
  menuItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuItemText: {
    fontSize: 15,
  },
});

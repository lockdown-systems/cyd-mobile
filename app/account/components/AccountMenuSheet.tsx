import { useCallback, useMemo, useState } from "react";
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

import { CydSignInModal } from "@/components/CydSignInModal";
import { Colors } from "@/constants/theme";
import { useCydAccount } from "@/contexts/CydAccountProvider";

export type AccountMenuSheetProps = {
  handle: string;
  palette: typeof Colors.light;
  visible: boolean;
  onClose: () => void;
  bottomInset: number;
  onSignOut?: () => Promise<void>;
  onReauthenticate?: () => Promise<void>;
  onRemoveAccount?: () => Promise<void>;
  onExportArchive?: () => Promise<void>;
  authStatus: "authenticated" | "signed_out" | "unknown";
};

type SettingsItem =
  | {
      type: "action";
      key: string;
      label: string;
      log: string;
      variant?: "danger";
    }
  | {
      type: "separator";
      key: string;
    }
  | {
      type: "info";
      key: string;
      label: string;
    };

type SettingsActionItem = Extract<SettingsItem, { type: "action" }>;

export function AccountMenuSheet({
  handle,
  palette,
  visible,
  onClose,
  bottomInset,
  onSignOut,
  onReauthenticate,
  onRemoveAccount,
  onExportArchive,
  authStatus,
}: AccountMenuSheetProps) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [signInModalVisible, setSignInModalVisible] = useState(false);
  const {
    state: cydState,
    signOut: cydSignOut,
    getDashboardURL,
  } = useCydAccount();
  const items = useMemo<SettingsItem[]>(
    () => [
      {
        type: "info",
        key: "bluesky-handle",
        label: `Bluesky account: ${handle}`,
      },
      {
        type: "action",
        key: "export-archive",
        label: "Export Bluesky archive",
        log: `Export archive tapped for ${handle}`,
      },
      ...(authStatus !== "authenticated"
        ? [
            {
              type: "action",
              key: "reauth",
              label: "Reauthenticate to Bluesky",
              log: `Reauthenticate tapped for ${handle}`,
            } as SettingsItem,
          ]
        : []),
      ...(authStatus === "authenticated"
        ? [
            {
              type: "action",
              key: "signout",
              label: "Sign out of Bluesky",
              log: `Sign out tapped for ${handle}`,
            } as SettingsItem,
          ]
        : []),
      {
        type: "action",
        key: "remove",
        label: "Remove account and data from Cyd",
        log: `Remove account tapped for ${handle}`,
        variant: "danger",
      },
      { type: "separator", key: "sep-cyd" },
      ...(cydState.isSignedIn
        ? [
            {
              type: "info",
              key: "cyd-account-info",
              label: `Cyd account: Signed in as ${cydState.userEmail}`,
            } as SettingsItem,
            {
              type: "action",
              key: "manage-cyd",
              label: "Manage my Cyd account",
              log: "Manage Cyd account tapped",
            } as SettingsItem,
            {
              type: "action",
              key: "signout-cyd",
              label: "Sign out of Cyd account",
              log: "Sign out of Cyd tapped",
            } as SettingsItem,
          ]
        : [
            {
              type: "info",
              key: "cyd-account-info",
              label: "Not signed in to Cyd",
            } as SettingsItem,
            {
              type: "action",
              key: "signin-cyd",
              label: "Sign in to Cyd to access premium features",
              log: "Sign in to Cyd tapped",
            } as SettingsItem,
          ]),
    ],
    [authStatus, handle, cydState.isSignedIn, cydState.userEmail],
  );

  const handleActionPress = useCallback(
    async (item: SettingsActionItem) => {
      console.log(`[Account Settings] ${item.log}`);

      if (pendingAction) {
        return;
      }

      if (item.key === "export-archive") {
        if (!onExportArchive) {
          Alert.alert(
            "Export unavailable",
            "This action is not supported here.",
          );
          onClose();
          return;
        }

        setPendingAction(item.key);
        setIsExporting(true);
        try {
          await onExportArchive();
          onClose();
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Unable to export archive right now.";
          Alert.alert("Export failed", message);
        } finally {
          setIsExporting(false);
          setPendingAction(null);
        }
        return;
      }

      setPendingAction(item.key);
      if (item.key === "signout") {
        if (!onSignOut) {
          Alert.alert(
            "Sign out unavailable",
            "This action is not supported here.",
          );
          setPendingAction(null);
          return;
        }

        try {
          await onSignOut();
          onClose();
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Unable to sign out of Bluesky right now.";
          Alert.alert("Sign out failed", message);
        } finally {
          setPendingAction(null);
        }
        return;
      }

      if (item.key === "reauth") {
        if (!onReauthenticate) {
          Alert.alert(
            "Reauthentication unavailable",
            "This action is not supported here.",
          );
          setPendingAction(null);
          return;
        }

        try {
          await onReauthenticate();
          onClose();
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Unable to reauthenticate with Bluesky right now.";
          Alert.alert("Reauthentication failed", message);
        } finally {
          setPendingAction(null);
        }
        return;
      }

      if (item.key === "remove") {
        if (!onRemoveAccount) {
          Alert.alert(
            "Removal unavailable",
            "This action is not supported here.",
          );
          return;
        }

        Alert.alert(
          "Remove account?",
          "This will delete any data you've backed up from this account from your device.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Remove",
              style: "destructive",
              onPress: () => {
                setPendingAction(item.key);
                void (async () => {
                  try {
                    await onRemoveAccount();
                    onClose();
                  } catch (err) {
                    const message =
                      err instanceof Error
                        ? err.message
                        : "Unable to remove this account right now.";
                    Alert.alert("Removal failed", message);
                  } finally {
                    setPendingAction(null);
                  }
                })();
              },
            },
          ],
        );
        return;
      }

      if (item.key === "manage-cyd") {
        const dashboardURL = getDashboardURL();
        void Linking.openURL(dashboardURL).catch((err) =>
          console.warn("Unable to open dashboard URL:", err),
        );
        onClose();
        setPendingAction(null);
        return;
      }

      if (item.key === "signout-cyd") {
        void cydSignOut();
        onClose();
        setPendingAction(null);
        return;
      }

      if (item.key === "signin-cyd") {
        onClose();
        setPendingAction(null);
        // Small delay to let the menu close before opening sign-in modal
        setTimeout(() => setSignInModalVisible(true), 300);
        return;
      }

      onClose();
      setPendingAction(null);
    },
    [
      onClose,
      onExportArchive,
      onReauthenticate,
      onRemoveAccount,
      onSignOut,
      pendingAction,
      cydSignOut,
      getDashboardURL,
    ],
  );

  const dangerColor = palette.danger ?? Colors.light.danger;

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        onRequestClose={onClose}
        statusBarTranslucent
      >
        <View style={styles.overlay}>
          <Pressable
            style={styles.overlayDismissArea}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close account settings"
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
            {items.map((item) => {
              if (item.type === "separator") {
                return (
                  <View
                    key={item.key}
                    style={[
                      styles.separator,
                      { borderColor: palette.icon + "22" },
                    ]}
                  />
                );
              }

              if (item.type === "info") {
                return (
                  <Text
                    key={item.key}
                    style={[styles.infoText, { color: palette.icon }]}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                );
              }

              const isDanger = item.variant === "danger";
              return (
                <Pressable
                  key={item.key}
                  onPress={() => {
                    void handleActionPress(item);
                  }}
                  style={({ pressed }) => [
                    styles.actionButton,
                    {
                      borderColor: palette.icon + "22",
                      backgroundColor: palette.background,
                      opacity: pressed || pendingAction !== null ? 0.9 : 1,
                    },
                    isDanger && {
                      borderColor: dangerColor + "66",
                      backgroundColor: dangerColor + "11",
                    },
                  ]}
                  accessibilityRole="button"
                  disabled={pendingAction !== null}
                >
                  <Text
                    style={[
                      styles.actionText,
                      { color: isDanger ? dangerColor : palette.text },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {isExporting && (
          <View style={styles.exportingOverlay}>
            <View
              style={[styles.exportingModal, { backgroundColor: palette.card }]}
            >
              <ActivityIndicator size="large" color={palette.tint} />
              <Text style={[styles.exportingText, { color: palette.text }]}>
                Preparing archive...
              </Text>
            </View>
          </View>
        )}
      </Modal>
      <CydSignInModal
        visible={signInModalVisible}
        onClose={() => setSignInModalVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  overlayDismissArea: {
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
  sheetTitle: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 4,
  },
  infoText: {
    fontSize: 13,
    textAlign: "center",
    marginBottom: 2,
  },
  actionButton: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  actionText: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  separator: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  exportingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  exportingModal: {
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    gap: 16,
    minWidth: 200,
  },
  exportingText: {
    fontSize: 16,
    fontWeight: "600",
  },
});

export default AccountMenuSheet;

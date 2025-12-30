import { useCallback, useMemo, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Colors } from "@/constants/theme";

export type AccountSettingsSheetProps = {
  handle: string;
  palette: typeof Colors.light;
  visible: boolean;
  onClose: () => void;
  bottomInset: number;
  onSignOut?: () => Promise<void>;
  onReauthenticate?: () => Promise<void>;
  onRemoveAccount?: () => Promise<void>;
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
    };

type SettingsActionItem = Extract<SettingsItem, { type: "action" }>;

export function AccountSettingsSheet({
  handle,
  palette,
  visible,
  onClose,
  bottomInset,
  onSignOut,
  onReauthenticate,
  onRemoveAccount,
  authStatus,
}: AccountSettingsSheetProps) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const items = useMemo<SettingsItem[]>(
    () => [
      {
        type: "action",
        key: "schedule",
        label: "Schedule Backing Up and Deleting",
        log: `Schedule saving and deleting tapped for ${handle}`,
      },
      { type: "separator", key: "sep-1" },
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
      { type: "separator", key: "sep-2" },
      {
        type: "action",
        key: "remove",
        label: "Remove account and data from Cyd",
        log: `Remove account tapped for ${handle}`,
        variant: "danger",
      },
    ],
    [authStatus, handle]
  );

  const handleActionPress = useCallback(
    async (item: SettingsActionItem) => {
      console.log(`[Account Settings] ${item.log}`);

      if (pendingAction) {
        return;
      }

      if (item.key === "schedule") {
        Alert.alert("TODO: This is not implemented yet.");
        onClose();
        return;
      }

      setPendingAction(item.key);
      if (item.key === "signout") {
        if (!onSignOut) {
          Alert.alert(
            "Sign out unavailable",
            "This action is not supported here."
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
            "This action is not supported here."
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
            "This action is not supported here."
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
          ]
        );
        return;
      }

      onClose();
      setPendingAction(null);
    },
    [onClose, onReauthenticate, onRemoveAccount, onSignOut, pendingAction]
  );

  const dangerColor = palette.danger ?? Colors.light.danger;

  return (
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
          <Text style={[styles.sheetTitle, { color: palette.text }]}>
            Account Settings
          </Text>
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
    </Modal>
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
});

export default AccountSettingsSheet;

import { useCallback, useMemo } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Colors } from "@/constants/theme";

export type AccountSettingsSheetProps = {
  handle: string;
  palette: typeof Colors.light;
  visible: boolean;
  onClose: () => void;
  bottomInset: number;
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
}: AccountSettingsSheetProps) {
  const items = useMemo<SettingsItem[]>(
    () => [
      {
        type: "action",
        key: "schedule",
        label: "Schedule Saving and Deleting",
        log: `Schedule saving and deleting tapped for ${handle}`,
      },
      { type: "separator", key: "sep-1" },
      {
        type: "action",
        key: "reauth",
        label: "Reauthenticate to Bluesky",
        log: `Reauthenticate tapped for ${handle}`,
      },
      {
        type: "action",
        key: "signout",
        label: "Sign out of Bluesky",
        log: `Sign out tapped for ${handle}`,
      },
      { type: "separator", key: "sep-2" },
      {
        type: "action",
        key: "remove",
        label: "Remove account and data from Cyd",
        log: `Remove account tapped for ${handle}`,
        variant: "danger",
      },
    ],
    [handle]
  );

  const handleActionPress = useCallback(
    (item: SettingsActionItem) => {
      console.log(`[Account Settings] ${item.log}`);
      onClose();
    },
    [onClose]
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
                onPress={() => handleActionPress(item)}
                style={({ pressed }) => [
                  styles.actionButton,
                  {
                    borderColor: palette.icon + "22",
                    backgroundColor: palette.background,
                    opacity: pressed ? 0.9 : 1,
                  },
                  isDanger && {
                    borderColor: dangerColor + "66",
                    backgroundColor: dangerColor + "11",
                  },
                ]}
                accessibilityRole="button"
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

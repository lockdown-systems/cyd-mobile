import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { getThemePalette } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type {
  BlueskyArchiveExportAccount,
  BlueskyArchiveExportState,
} from "@/hooks/use-bluesky-archive-export";

/**
 * What writing a Cyd Bluesky archive looks like while it happens.
 *
 * The sibling of `BlueskyArchiveImportModal`, and deliberately shaped like it:
 * both are reached from the same menu, and the two halves of getting your data
 * in and out of Cyd should not feel like two different applications.
 *
 * Three of its states are the person deciding rather than Cyd working. Which
 * account, when this device holds more than one. Whether to write a plaintext
 * file at all — asked before the file exists, because afterwards is too late
 * (ADR 0013). And where the finished archive goes, which is the only step that
 * lets Cyd throw the staged copy away.
 */

export type BlueskyArchiveExportModalProps = {
  state: BlueskyArchiveExportState;
  onChoose: (account: BlueskyArchiveExportAccount) => void;
  onConfirm: () => void;
  onSaveToDevice: () => void;
  onShare: () => void;
  onCancel: () => void;
  onDismiss: () => void;
};

export function BlueskyArchiveExportModal({
  state,
  onChoose,
  onConfirm,
  onSaveToDevice,
  onShare,
  onCancel,
  onDismiss,
}: BlueskyArchiveExportModalProps) {
  const palette = getThemePalette(useColorScheme());

  if (state.status === "idle") {
    return null;
  }

  const action = (
    label: string,
    onPress: () => void,
    emphasis: "primary" | "quiet" = "quiet",
  ) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.action,
        {
          borderColor: palette.icon + "22",
          backgroundColor:
            emphasis === "primary" ? palette.tint + "22" : palette.background,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <Text style={[styles.actionText, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );

  /**
   * What the Android back button does, which is what the nearest button does.
   *
   * Backing out of a question is cancelling it. Backing out of a finished
   * archive is *not*: the archive is still staged, and dismissing keeps it for
   * the next attempt rather than throwing away the only copy.
   */
  const handleRequestClose = () => {
    if (
      state.status === "ready" ||
      state.status === "done" ||
      state.status === "failed" ||
      state.status === "warning"
    ) {
      onDismiss();
      return;
    }
    if (state.status === "working" && !state.cancellable) {
      return;
    }
    onCancel();
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleRequestClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: palette.background }]}>
          {state.status === "choosing" ? (
            <>
              <Text style={[styles.title, { color: palette.text }]}>
                Which account?
              </Text>
              <ScrollView style={styles.scroll}>
                {state.accounts.map((account) => (
                  <Pressable
                    key={account.uuid}
                    onPress={() => onChoose(account)}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.choiceButton,
                      {
                        borderColor: palette.icon + "22",
                        opacity: pressed ? 0.9 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.choiceTitle, { color: palette.text }]}>
                      {breakableHandle(account.handle)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {action("Cancel", onCancel)}
            </>
          ) : null}

          {state.status === "warning" ? (
            <>
              <Text style={[styles.title, { color: palette.text }]}>
                This archive is not encrypted
              </Text>
              <Text style={[styles.handle, { color: palette.text }]}>
                {breakableHandle(state.handle)}
              </Text>
              <Text style={[styles.body, { color: palette.icon }]}>
                Your posts, chats and media go into it as plain text, and anyone
                who opens the file can read them. Cyd protects your Bluesky
                connection, not the archive — so put it somewhere you trust,
                like an encrypted drive or a password manager&apos;s vault.
              </Text>
              {state.resuming ? (
                <Text style={[styles.body, { color: palette.icon }]}>
                  Cyd will carry on the export it started earlier, from the
                  moment that export began.
                </Text>
              ) : null}
              {action("Export anyway", onConfirm, "primary")}
              {/* Not cancelling: declining to export now is not asking Cyd to
                  throw away an export an earlier launch was interrupted in. */}
              {action("Not now", onDismiss)}
            </>
          ) : null}

          {state.status === "working" ? (
            <>
              <ActivityIndicator size="large" color={palette.tint} />
              <Text style={[styles.title, { color: palette.text }]}>
                {state.message}
              </Text>
              {state.fraction !== null ? (
                <Text style={[styles.body, { color: palette.icon }]}>
                  {Math.round(state.fraction * 100)}%
                </Text>
              ) : null}
              {state.cancellable ? action("Cancel", onCancel) : null}
            </>
          ) : null}

          {state.status === "ready" ? (
            <>
              <Text style={[styles.title, { color: palette.text }]}>
                Your archive is ready
              </Text>
              <Text selectable style={[styles.path, { color: palette.text }]}>
                {state.fileName}
              </Text>
              {state.lines.map((line) => (
                <Text key={line} style={[styles.body, { color: palette.icon }]}>
                  {line}
                </Text>
              ))}
              <Text style={[styles.body, { color: palette.icon }]}>
                Save it to a folder on this device, or hand it to another app.
                Cyd keeps it until you do one of those.
              </Text>
              {/* Saving is first because it is the one that keeps the archive
                  on a device you control. A share sheet on Android cannot offer
                  local storage at all, so without this there is no way to get
                  the file off Cyd except through somebody else's service. */}
              {action("Save to device", onSaveToDevice, "primary")}
              {action("Share", onShare)}
              {/* Not cancelling: the archive stays staged and the next export
                  offers this same file rather than building it again. */}
              {action("Not now", onDismiss)}
            </>
          ) : null}

          {state.status === "done" ? (
            <>
              <Text style={[styles.title, { color: palette.text }]}>
                Exported
              </Text>
              <Text selectable style={[styles.path, { color: palette.text }]}>
                {state.fileName}
              </Text>
              {state.lines.map((line) => (
                <Text key={line} style={[styles.body, { color: palette.icon }]}>
                  {line}
                </Text>
              ))}
              {action("Done", onDismiss, "primary")}
            </>
          ) : null}

          {state.status === "failed" ? (
            <>
              <Text style={[styles.title, { color: palette.text }]}>
                Export failed
              </Text>
              <Text style={[styles.body, { color: palette.icon }]}>
                {state.message}
              </Text>
              {/* Whatever it staged before failing is still there, so trying
                  again carries on from it rather than starting over. */}
              {action("Try again", onConfirm, "primary")}
              {action("Close", onDismiss)}
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/**
 * A handle written so a line box breaks it where a reader would.
 *
 * The same treatment the import modal gives one, and for the same reason: a
 * handle is one unbroken token, and a heading splits it wherever it happens to
 * run out of room unless it is offered somewhere better.
 */
function breakableHandle(handle: string): string {
  return `@${handle.replace(/^@/, "")}`.replace(/\./g, "​.");
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxHeight: "85%",
    borderRadius: 16,
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  handle: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
    marginTop: -4,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  path: {
    fontSize: 12,
    fontFamily: "monospace",
    textAlign: "center",
  },
  scroll: {
    maxHeight: 280,
  },
  choiceButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  choiceTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  action: {
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
});

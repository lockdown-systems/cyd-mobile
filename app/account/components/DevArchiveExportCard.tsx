import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/account/shared-tab-components";
import {
  useBlueskyArchiveExport,
  type BlueskyArchiveExportRuntime,
} from "@/hooks/use-bluesky-archive-export";
import type { AccountTabPalette } from "@/types/account-tabs";

/**
 * The development-only way to write a Cyd Bluesky archive.
 *
 * Mobile builds its version 2 writer before the readers that consume it, so
 * that reader work has real archives to be tested against (ADR 0004). What
 * that ordering must not do is put an export button in front of people before
 * #100 proves an archive Mobile writes can be read back — by Mobile and by
 * Desktop. Hence `__DEV__`: this renders nothing at all in a release build.
 *
 * The flow behind the button is the shippable one, though: the plaintext
 * warning, a resumable export, the share sheet, and staging cleared once the
 * archive is somewhere else (#99). When #100 opens the gate, what changes is
 * where this lives and what it is called, not what it does.
 */

export type DevArchiveExportCardProps = {
  accountId: number;
  accountUUID: string;
  palette: AccountTabPalette;
  /** Stands in for the phone in tests; the hook builds the real one. */
  runtime?: BlueskyArchiveExportRuntime;
};

export function DevArchiveExportCard({
  accountId,
  accountUUID,
  palette,
  runtime,
}: DevArchiveExportCardProps) {
  const archiveExport = useBlueskyArchiveExport({
    accountId,
    accountUUID,
    runtime,
  });
  const { state } = archiveExport;

  if (!__DEV__) {
    return null;
  }

  const action = (label: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.action,
        { borderColor: palette.icon + "44", opacity: pressed ? 0.9 : 1 },
      ]}
    >
      <Text style={[styles.actionText, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View
      style={[
        styles.card,
        { borderColor: palette.icon + "44", backgroundColor: palette.card },
      ]}
    >
      <Text style={[styles.title, { color: palette.text }]}>
        Export a Cyd Bluesky archive (development only)
      </Text>
      <Text style={[styles.body, { color: palette.icon }]}>
        Writes a version 2 archive and offers it to the share sheet. Not
        available in release builds until Bluesky archive import is proven.
      </Text>

      {state.status === "idle" || state.status === "warning" ? (
        <PrimaryButton
          label="Export archive"
          palette={palette}
          onPress={() => void archiveExport.start()}
          disabled={state.status === "warning"}
        />
      ) : null}

      {state.status === "warning" ? (
        <View style={styles.status}>
          <Text style={[styles.warning, { color: palette.text }]}>
            This archive is not encrypted.
          </Text>
          <Text style={[styles.body, { color: palette.icon }]}>
            Your posts, chats and media go into it as plain text, and anyone who
            opens the file can read them. Cyd protects your Bluesky connection,
            not the archive — so put it somewhere you trust, like an encrypted
            drive or a password manager&apos;s vault.
          </Text>
          {state.resuming ? (
            <Text style={[styles.body, { color: palette.icon }]}>
              Cyd will carry on the export it started earlier, from the moment
              that export began.
            </Text>
          ) : null}
          <View style={styles.actions}>
            {action("Export anyway", () => void archiveExport.confirm())}
            {/* Not cancelling: declining to export now is not asking Cyd to
                throw away an export an earlier launch was interrupted in. */}
            {action("Not now", archiveExport.dismiss)}
          </View>
        </View>
      ) : null}

      {state.status === "working" ? (
        <View style={styles.status}>
          <ActivityIndicator color={palette.tint} />
          <Text style={[styles.body, { color: palette.icon }]}>
            {state.message}
            {state.fraction !== null
              ? ` ${Math.round(state.fraction * 100)}%`
              : ""}
          </Text>
          {state.cancellable ? action("Cancel", archiveExport.cancel) : null}
        </View>
      ) : null}

      {state.status === "done" ? (
        <View style={styles.status}>
          <Text selectable style={[styles.path, { color: palette.text }]}>
            {state.fileName}
          </Text>
          {state.lines.map((line) => (
            <Text key={line} style={[styles.body, { color: palette.icon }]}>
              {line}
            </Text>
          ))}
          {action("Done", archiveExport.dismiss)}
        </View>
      ) : null}

      {state.status === "failed" ? (
        <View style={styles.status}>
          <Text style={[styles.body, { color: palette.tint }]}>
            {state.message}
          </Text>
          {/* Whatever it staged before failing is still there, so trying again
              carries on from it rather than starting the export over. */}
          <View style={styles.actions}>
            {action("Try again", () => void archiveExport.confirm())}
            {action("Close", archiveExport.dismiss)}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    borderStyle: "dashed",
    padding: 16,
    gap: 8,
    marginTop: 24,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
  },
  warning: {
    fontSize: 14,
    fontWeight: "600",
  },
  path: {
    fontSize: 11,
    fontFamily: "monospace",
  },
  status: {
    gap: 6,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
  action: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: "flex-start",
  },
  actionText: {
    fontSize: 13,
    fontWeight: "600",
  },
});

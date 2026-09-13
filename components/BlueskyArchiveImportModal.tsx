import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { getThemePalette } from "@/constants/theme";
import {
  totalMergeChanges,
  type BlueskyArchiveMergePreview,
} from "@/services/archive-merge";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { BlueskyArchiveImportState } from "@/hooks/use-bluesky-archive-import";

/**
 * What a Bluesky archive import looks like while it happens.
 *
 * Every state this shows is a point where the import is waiting on the person:
 * an archive big enough to be worth asking about, records a merge would bring
 * back, or one Bluesky identity held by two local accounts. The progress and
 * the outcome are here for the same reason — an import that moves a gigabyte
 * of somebody's own posts should never look like a frozen screen.
 */

export type BlueskyArchiveImportModalProps = {
  state: BlueskyArchiveImportState;
  onConfirmLargeArchive: () => void;
  onConfirmMerge: () => void;
  /** Connect the account an import just restored, from where it was restored. */
  onSignIn: (handle: string) => void;
  onCancel: () => void;
  onDismiss: () => void;
};

export function BlueskyArchiveImportModal({
  state,
  onConfirmLargeArchive,
  onConfirmMerge,
  onSignIn,
  onCancel,
  onDismiss,
}: BlueskyArchiveImportModalProps) {
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
   * Backing out of a question is cancelling it, and backing out of a report is
   * dismissing it. The one state with no button is a merge being written, and
   * back does nothing there for the same reason there is nothing to press: a
   * commit cannot be called back, and half a merge is not a state to leave
   * somebody in.
   */
  const handleRequestClose = () => {
    if (state.status === "done" || state.status === "failed") {
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

          {state.status === "needs-confirmation" ? (
            <>
              <Text style={[styles.title, { color: palette.text }]}>
                This is a big archive
              </Text>
              <Text style={[styles.body, { color: palette.icon }]}>
                {state.message}
              </Text>
              {action("Import it", onConfirmLargeArchive, "primary")}
              {action("Cancel", onCancel)}
            </>
          ) : null}

          {state.status === "reviewing" ? (
            <>
              <Text style={[styles.title, { color: palette.text }]}>
                Merge into
              </Text>
              <Text style={[styles.handle, { color: palette.text }]}>
                {breakableHandle(state.handle)}
              </Text>
              {describeMerge(state.preview).map((line) => (
                <Text key={line} style={[styles.body, { color: palette.icon }]}>
                  {line}
                </Text>
              ))}
              {action("Import", onConfirmMerge, "primary")}
              {action("Cancel", onCancel)}
            </>
          ) : null}

          {state.status === "done" ? (
            <>
              <Text style={[styles.title, { color: palette.text }]}>
                {state.title}
              </Text>
              <Text style={[styles.handle, { color: palette.text }]}>
                {breakableHandle(state.handle)}
              </Text>
              {state.lines.map((line) => (
                <Text key={line} style={[styles.body, { color: palette.icon }]}>
                  {line}
                </Text>
              ))}
              {state.offerSignIn ? (
                <>
                  {action(
                    "Sign in to Bluesky",
                    () => onSignIn(state.handle),
                    "primary",
                  )}
                  {action("Not now", onDismiss)}
                </>
              ) : (
                action("Done", onDismiss, "primary")
              )}
            </>
          ) : null}

          {state.status === "failed" ? (
            <>
              <Text style={[styles.title, { color: palette.text }]}>
                Import failed
              </Text>
              <Text style={[styles.body, { color: palette.icon }]}>
                {state.message}
              </Text>
              {action("Close", onDismiss, "primary")}
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
 * A handle is a single token with no spaces in it, so a heading wide enough
 * for most of one splits it wherever it happens to run out of room —
 * "@glittertop-cyd.bsky" above ".social". A zero-width space before each dot
 * offers the layout the same break points a person would choose, and leaves
 * nothing on screen. Nothing is truncated: a handle is how somebody knows
 * which account this is.
 */
function breakableHandle(handle: string): string {
  return `@${handle.replace(/^@/, "")}`.replace(/\./g, "\u200B.");
}

/** `2 posts`, and `1 post` rather than `1 posts`. */
function count(total: number, noun: string): string {
  return `${total.toLocaleString()} ${noun}${total === 1 ? "" : "s"}`;
}

/**
 * What this archive has that the account does not, a line per kind.
 *
 * Named the way Browse names them, so somebody who reads "2 likes will be
 * added" can go to the Likes tab afterwards and find two more than before.
 * A kind with nothing to add says nothing at all: a list of zeroes is a list
 * of things that are not happening.
 *
 * What a merge leaves alone is not mentioned either. A merge cannot reach an
 * account's settings, schedule or Bluesky connection — the ports have no way
 * to — so saying so every time is a sentence that is never news.
 */
function describeMerge(preview: BlueskyArchiveMergePreview): string[] {
  const totals = totalMergeChanges(preview.summary);

  if (totals.total === 0) {
    return [
      "This archive holds nothing this account does not already have. Importing it will change nothing.",
    ];
  }

  const added = preview.summary.addedRecords;
  const kinds: [number, string][] = [
    [added.posts, "post"],
    [added.reposts, "repost"],
    [added.likes, "like"],
    [added.bookmarks, "bookmark"],
    [added.follows, "follow"],
    [added.chats, "chat"],
    [added.messages, "message"],
    [totals.files.added, "media file"],
  ];

  const lines = kinds
    .filter(([total]) => total > 0)
    .map(([total, noun]) => `${count(total, noun)} will be added.`);

  if (totals.files.updated > 0) {
    // A file this account has a record of but never managed to download.
    lines.push(`${count(totals.files.updated, "media file")} will be restored.`);
  }
  if (totals.records.updated > 0) {
    lines.push(`${count(totals.records.updated, "record")} will be filled in.`);
  }
  if (lines.length === 0) {
    // Only supporting rows changed: an author, an attachment, a link preview.
    lines.push("Some records will gain details this account is missing.");
  }
  if (preview.archive.completeness === "incomplete") {
    lines.push(
      "This archive is missing some files, so a few records will arrive without their media.",
    );
  }
  return lines;
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
  scroll: {
    maxHeight: 280,
  },
  choice: {
    gap: 6,
    marginBottom: 12,
  },
  choiceButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  choiceTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  settingsPick: {
    fontSize: 13,
    paddingHorizontal: 4,
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

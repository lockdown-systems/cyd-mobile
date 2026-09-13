import { useState } from "react";
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

type ReconciliationChoice = {
  survivingUuid: string;
  settingsFromUuid: string;
};

export type BlueskyArchiveImportModalProps = {
  state: BlueskyArchiveImportState;
  onConfirmLargeArchive: () => void;
  onConfirmMerge: () => void;
  onKeepAccount: (choice: {
    survivingUuid: string;
    settingsFromUuid: string;
  }) => void;
  /** Connect the account an import just restored, from where it was restored. */
  onSignIn: (handle: string) => void;
  onCancel: () => void;
  onDismiss: () => void;
};

export function BlueskyArchiveImportModal({
  state,
  onConfirmLargeArchive,
  onConfirmMerge,
  onKeepAccount,
  onSignIn,
  onCancel,
  onDismiss,
}: BlueskyArchiveImportModalProps) {
  const palette = getThemePalette(useColorScheme());
  const [picked, setPicked] = useState<ReconciliationChoice | null>(null);

  const reconciling = state.status === "reconciling" ? state.preview : null;
  /**
   * Which account is selected, before anybody has touched anything.
   *
   * The default is the one holding the most, because it is the one somebody is
   * most likely to recognise as theirs — but it is only a default, and a
   * selection that names an account this preview does not hold is stale and
   * falls back to it.
   */
  const known = (uuid: string | undefined): boolean =>
    reconciling?.accounts.some((account) => account.uuid === uuid) === true;
  const fallback = reconciling
    ? [...reconciling.accounts].sort(
        (left, right) => totalRecords(right) - totalRecords(left),
      )[0]?.uuid
    : undefined;
  const survivingUuid = known(picked?.survivingUuid)
    ? picked!.survivingUuid
    : fallback;
  const settingsFromUuid = known(picked?.settingsFromUuid)
    ? picked!.settingsFromUuid
    : survivingUuid;

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

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
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

          {state.status === "reconciling" && survivingUuid ? (
            <>
              <Text style={[styles.title, { color: palette.text }]}>
                Two accounts, one Bluesky identity
              </Text>
              <Text style={[styles.body, { color: palette.icon }]}>
                {state.message}
              </Text>
              <ScrollView style={styles.scroll}>
                {state.preview.accounts.map((account) => (
                  <View key={account.uuid} style={styles.choice}>
                    <Pressable
                      onPress={() =>
                        setPicked({
                          survivingUuid: account.uuid,
                          settingsFromUuid: settingsFromUuid ?? account.uuid,
                        })
                      }
                      accessibilityRole="radio"
                      accessibilityState={{
                        selected: account.uuid === survivingUuid,
                      }}
                      style={[
                        styles.choiceButton,
                        {
                          borderColor:
                            account.uuid === survivingUuid
                              ? palette.tint
                              : palette.icon + "22",
                        },
                      ]}
                    >
                      <Text style={[styles.choiceTitle, { color: palette.text }]}>
                        {account.handle ?? account.uuid}
                      </Text>
                      <Text style={[styles.body, { color: palette.icon }]}>
                        {account.counts.posts} posts · {account.counts.chats}{" "}
                        chats · {account.counts.follows} follows
                      </Text>
                      {account.gains.total > 0 ? (
                        <Text style={[styles.body, { color: palette.icon }]}>
                          Keeping this one brings back {account.gains.total}{" "}
                          records it does not have, including{" "}
                          {describeRecord(account.gains.records[0])}.
                        </Text>
                      ) : null}
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        setPicked({
                          survivingUuid,
                          settingsFromUuid: account.uuid,
                        })
                      }
                      accessibilityRole="radio"
                      accessibilityState={{
                        selected: account.uuid === settingsFromUuid,
                      }}
                    >
                      <Text
                        style={[
                          styles.settingsPick,
                          {
                            color:
                              account.uuid === settingsFromUuid
                                ? palette.tint
                                : palette.icon,
                          },
                        ]}
                      >
                        {account.uuid === settingsFromUuid
                          ? "✓ Keeping these settings and schedule"
                          : "Keep these settings and schedule"}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
              <Text style={[styles.body, { color: palette.icon }]}>
                Nothing is lost either way: the account you keep ends up with
                everything both of them held.
              </Text>
              {action(
                "Keep this account and continue",
                () =>
                  onKeepAccount({
                    survivingUuid,
                    settingsFromUuid: settingsFromUuid ?? survivingUuid,
                  }),
                "primary",
              )}
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
              <ScrollView style={styles.scroll}>
                <Text style={[styles.body, { color: palette.icon }]}>
                  {describeMerge(state.preview)}
                </Text>
                {state.preview.summary.restorations.total > 0 ? (
                  <>
                    <Text style={[styles.subtitle, { color: palette.text }]}>
                      Coming back to this account
                    </Text>
                    <Text style={[styles.body, { color: palette.icon }]}>
                      These are not in Cyd right now. If you deleted any of them
                      from Cyd on purpose, importing brings them back.
                    </Text>
                    {state.preview.summary.restorations.records.map(
                      (record) => (
                        <Text
                          key={`${record.category}:${record.id}`}
                          numberOfLines={2}
                          style={[styles.record, { color: palette.text }]}
                        >
                          {record.text?.trim()
                            ? `${record.category}: ${record.text.trim()}`
                            : `${record.category}: ${record.id}`}
                        </Text>
                      ),
                    )}
                    {state.preview.summary.restorations.total >
                    state.preview.summary.restorations.records.length ? (
                      <Text style={[styles.body, { color: palette.icon }]}>
                        …and{" "}
                        {state.preview.summary.restorations.total -
                          state.preview.summary.restorations.records.length}{" "}
                        more.
                      </Text>
                    ) : null}
                  </>
                ) : null}
              </ScrollView>
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

/** One restored record, short enough to sit inside a sentence. */
function describeRecord(record: {
  category: string;
  id: string;
  text: string | null;
}): string {
  const text = record.text?.trim();
  return text ? `“${text.slice(0, 60)}”` : `one ${record.category} record`;
}

function totalRecords(account: {
  counts: { posts: number; chats: number; messages: number; follows: number };
}): number {
  return (
    account.counts.posts +
    account.counts.chats +
    account.counts.messages +
    account.counts.follows
  );
}

/** `2 posts`, and `1 post` rather than `1 posts`. */
function count(total: number, noun: string): string {
  return `${total.toLocaleString()} ${noun}${total === 1 ? "" : "s"}`;
}

/** "a, b and c", so a sentence can be built out of whatever is true. */
function sentence(clauses: string[]): string {
  if (clauses.length <= 1) {
    return clauses[0] ?? "";
  }
  return `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;
}

/**
 * One sentence about what this archive has that the account does not.
 *
 * Every kind of change counts, not only the ones with a familiar name. An
 * export taken again once a download finished differs from the one before it
 * by a single image, and telling somebody that importing it changes nothing
 * would be both wrong and the exact case they are trying to fix.
 */
function describeMerge(preview: BlueskyArchiveMergePreview): string {
  const totals = totalMergeChanges(preview.summary);

  if (totals.total === 0) {
    return "This archive holds nothing this account does not already have. Importing it will change nothing.";
  }

  const files = totals.files.added + totals.files.updated;
  const clauses: string[] = [];
  if (totals.records.added > 0) {
    clauses.push(`${count(totals.records.added, "record")} will be added`);
  }
  if (totals.records.updated > 0) {
    clauses.push(`${totals.records.updated.toLocaleString()} will be filled in`);
  }
  if (files > 0) {
    clauses.push(`${count(files, "media file")} will arrive`);
  }
  if (clauses.length === 0) {
    // Only supporting rows changed: an author, an attachment, a link preview.
    clauses.push("some records will gain details this account is missing");
  }

  const incomplete =
    preview.archive.completeness === "incomplete"
      ? " This archive is missing some files, so a few records will arrive without their media."
      : "";
  return `${sentence(clauses)}. Your settings, schedule and Bluesky connection are left alone.${incomplete}`;
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
  subtitle: {
    fontSize: 15,
    fontWeight: "600",
    marginTop: 12,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  record: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
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

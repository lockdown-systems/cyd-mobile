import { Pressable, StyleSheet, Text } from "react-native";

import type { ThemePalette } from "@/constants/theme";

/**
 * What the two Cyd Bluesky archive modals share.
 *
 * Import and export are reached from the same menu and are halves of one
 * thing — moving your Bluesky saved data between Cyd installations — so
 * looking alike is the point rather than a coincidence. Keeping the sheet,
 * the buttons and the handle treatment here is what stops them drifting into
 * two applications one release at a time.
 *
 * What is deliberately *not* here is either modal's states. Those are the two
 * flows, and they have almost nothing in common: one asks about a merge, the
 * other about where a file goes.
 */

export type ArchiveModalEmphasis = "primary" | "quiet";

/** One button in an archive modal's sheet. */
export function ArchiveModalAction({
  label,
  onPress,
  palette,
  emphasis = "quiet",
}: {
  label: string;
  onPress: () => void;
  palette: ThemePalette;
  emphasis?: ArchiveModalEmphasis;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        archiveModalStyles.action,
        {
          borderColor: palette.icon + "22",
          backgroundColor:
            emphasis === "primary" ? palette.tint + "22" : palette.background,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <Text style={[archiveModalStyles.actionText, { color: palette.text }]}>
        {label}
      </Text>
    </Pressable>
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
export function breakableHandle(handle: string): string {
  return `@${handle.replace(/^@/, "")}`.replace(/\./g, "​.");
}

export const archiveModalStyles = StyleSheet.create({
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

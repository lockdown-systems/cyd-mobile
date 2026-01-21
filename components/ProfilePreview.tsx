import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import type { ProfileData } from "@/controllers/bluesky/types";
import type { AccountTabPalette } from "@/types/account-tabs";

type ProfilePreviewProps = {
  profile: ProfileData;
  palette: AccountTabPalette;
  /** Optional action label to display (e.g., "Unfollowing...") */
  actionLabel?: string;
};

function Avatar({ uri, size = 48 }: { uri?: string | null; size?: number }) {
  if (!uri) {
    return (
      <View
        style={[
          styles.avatar,
          styles.avatarPlaceholder,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      />
    );
  }
  return (
    <Image
      key={uri}
      source={{ uri }}
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    />
  );
}

export function ProfilePreview({
  profile,
  palette,
  actionLabel,
}: ProfilePreviewProps) {
  const avatarUri = profile.avatarUrl ?? null;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: palette.card,
          borderColor: palette.icon + "22",
        },
      ]}
    >
      <Avatar uri={avatarUri} size={48} />
      <View style={styles.infoContainer}>
        <Text
          style={[styles.displayName, { color: palette.text }]}
          numberOfLines={1}
        >
          {profile.displayName || profile.handle}
        </Text>
        <Text
          style={[styles.handle, { color: palette.icon }]}
          numberOfLines={1}
        >
          @{profile.handle}
        </Text>
        {actionLabel && (
          <Text style={[styles.actionLabel, { color: palette.tint }]}>
            {actionLabel}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  avatar: {
    backgroundColor: "#e0e0e0",
  },
  avatarPlaceholder: {
    backgroundColor: "#ccc",
  },
  infoContainer: {
    flex: 1,
    gap: 2,
  },
  displayName: {
    fontSize: 16,
    fontWeight: "600",
  },
  handle: {
    fontSize: 14,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: "500",
    marginTop: 4,
  },
});

export default ProfilePreview;

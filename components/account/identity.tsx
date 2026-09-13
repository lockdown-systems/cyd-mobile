import { MaterialIcons } from "@expo/vector-icons";
import { Image, StyleSheet, View } from "react-native";

/**
 * What to call a Bluesky local account, and what to show where its avatar goes.
 *
 * A Bluesky local account restored from a Cyd Bluesky archive usually has
 * neither. Avatars are URLs Cyd never preserves (they are not part of a Cyd
 * Bluesky archive at all), and a display name nobody ever set arrives as an
 * empty string rather than as nothing — the same absence-as-empty-string the
 * merge's `populated` rule already refuses to treat as an observation.
 *
 * Both screens that show an account fell through that gap into a blank name
 * and a "?", so the fallbacks live here once: an account is named by its
 * handle when it has nothing better, and an account with no avatar gets a
 * person rather than a punctuation mark.
 */

export type AccountIdentity = {
  handle: string;
  displayName: string | null;
};

/** The handle as somebody would write it, whichever form it is stored in. */
export function accountUsername(handle: string): string {
  return handle.startsWith("@") ? handle : `@${handle}`;
}

/**
 * The name to show for an account.
 *
 * A blank display name is not a name, so it does not get to be one: the handle
 * is what is left, and it always names somebody.
 */
export function accountDisplayName(account: AccountIdentity): string {
  const displayName = account.displayName?.trim();
  return displayName ? displayName : accountUsername(account.handle);
}

export type AccountAvatarProps = {
  uri: string | null;
  size: number;
  palette: { icon: string };
};

export function AccountAvatar({ uri, size, palette }: AccountAvatarProps) {
  const shape = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderColor: palette.icon + "33",
    backgroundColor: palette.icon + "20",
  };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[styles.avatar, shape]}
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View style={[styles.avatar, styles.fallback, shape]}>
      <MaterialIcons
        name="person"
        size={Math.round(size * 0.6)}
        color={palette.icon}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
});

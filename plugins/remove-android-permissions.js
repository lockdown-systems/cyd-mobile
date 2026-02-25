/**
 * Expo config plugin that removes unnecessary Android permissions from the
 * merged manifest. These permissions are pulled in by transitive dependencies
 * (expo-file-system, ShortcutBadger via expo-notifications) but are not used
 * by the app.
 *
 * This replaces manual `tools:node="remove"` edits in the generated
 * AndroidManifest.xml, which would be lost on every `expo prebuild --clean`.
 *
 * We both:
 *  1. Remove unwanted permissions from the app's own manifest (so prebuild
 *     doesn't declare them).
 *  2. Add `tools:node="remove"` entries so that Gradle's manifest merger
 *     also strips them when they come from library AARs.
 */
const { withAndroidManifest } = require("expo/config-plugins");

/** Permissions to strip from the final manifest. */
const PERMISSIONS_TO_REMOVE = [
  // expo-file-system requests these but the app only uses internal storage
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",

  // expo-dev-client adds this for the dev overlay; not needed in production
  "android.permission.SYSTEM_ALERT_WINDOW",

  // ShortcutBadger (bundled by expo-notifications) adds 16 launcher-badge
  // permissions for various OEMs. The app never sets badge counts
  // (shouldSetBadge: false), so none are needed.
  "com.sec.android.provider.badge.permission.READ",
  "com.sec.android.provider.badge.permission.WRITE",
  "com.htc.launcher.permission.READ_SETTINGS",
  "com.htc.launcher.permission.UPDATE_SHORTCUT",
  "com.sonyericsson.home.permission.BROADCAST_BADGE",
  "com.sonymobile.home.permission.PROVIDER_INSERT_BADGE",
  "com.anddoes.launcher.permission.UPDATE_COUNT",
  "com.majeur.launcher.permission.UPDATE_BADGE",
  "com.huawei.android.launcher.permission.CHANGE_BADGE",
  "com.huawei.android.launcher.permission.READ_SETTINGS",
  "com.huawei.android.launcher.permission.WRITE_SETTINGS",
  "android.permission.READ_APP_BADGE",
  "com.oppo.launcher.permission.READ_SETTINGS",
  "com.oppo.launcher.permission.WRITE_SETTINGS",
  "me.everything.badger.permission.BADGE_COUNT_READ",
  "me.everything.badger.permission.BADGE_COUNT_WRITE",
];

const removePermissionsSet = new Set(PERMISSIONS_TO_REMOVE);

/**
 * @param {import("expo/config").ExpoConfig} config
 */
function withRemovedPermissions(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // Ensure the tools namespace is declared on the root <manifest> element
    // so that `tools:node="remove"` attributes are valid XML.
    if (!manifest.$) {
      manifest.$ = {};
    }
    manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";

    // 1. Remove any matching permissions that prebuild itself added
    if (manifest["uses-permission"]) {
      manifest["uses-permission"] = manifest["uses-permission"].filter(
        (perm) => {
          const name = perm.$?.["android:name"];
          return !removePermissionsSet.has(name);
        },
      );
    } else {
      manifest["uses-permission"] = [];
    }

    // Also filter <uses-permission-sdk-23> if present
    if (manifest["uses-permission-sdk-23"]) {
      manifest["uses-permission-sdk-23"] = manifest[
        "uses-permission-sdk-23"
      ].filter((perm) => {
        const name = perm.$?.["android:name"];
        return !removePermissionsSet.has(name);
      });
    }

    // 2. Add tools:node="remove" entries so the Gradle manifest merger
    //    strips these permissions when they come from library AARs.
    const existingNames = new Set(
      manifest["uses-permission"].map((p) => p.$?.["android:name"]),
    );

    for (const permission of PERMISSIONS_TO_REMOVE) {
      if (!existingNames.has(permission)) {
        manifest["uses-permission"].push({
          $: {
            "android:name": permission,
            "tools:node": "remove",
          },
        });
      }
    }

    return config;
  });
}

module.exports = withRemovedPermissions;

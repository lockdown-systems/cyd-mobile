# Allow OS backup of committed account data

Cyd Mobile leaves committed per-account databases and media eligible for normal iOS and Android device backup because users expect Cyd data to restore with their device. Temporary import/export staging and reproducible caches are excluded to avoid backing up partial or inflated working state, while OAuth connection material follows the separate Keychain or Keystore backup policy.

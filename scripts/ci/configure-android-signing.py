#!/usr/bin/env python3
"""Patch the Expo-generated build.gradle to use the upload keystore for release signing."""

path = "android/app/build.gradle"
with open(path) as f:
    content = f.read()

# Add release signing config after the debug block
release_config = """
        release {
            storeFile file("upload.jks")
            storePassword findProperty("UPLOAD_STORE_PASSWORD") ?: ""
            keyAlias findProperty("UPLOAD_KEY_ALIAS") ?: ""
            keyPassword findProperty("UPLOAD_KEY_PASSWORD") ?: ""
        }"""

content = content.replace(
    "storePassword 'android'\n            keyAlias 'androiddebugkey'\n            keyPassword 'android'\n        }\n    }",
    "storePassword 'android'\n            keyAlias 'androiddebugkey'\n            keyPassword 'android'\n        }"
    + release_config
    + "\n    }",
)

# Use release signing config for release builds
content = content.replace(
    "release {\n            // Caution! In production, you need to generate your own keystore file.\n            // see https://reactnative.dev/docs/signed-apk-android.\n            signingConfig signingConfigs.debug",
    "release {\n            signingConfig signingConfigs.release",
)

with open(path, "w") as f:
    f.write(content)

print("Patched build.gradle for release signing")

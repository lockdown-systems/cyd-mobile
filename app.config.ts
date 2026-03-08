import { ConfigContext, ExpoConfig } from "expo/config";

import packageJson from "./package.json";

export default ({ config }: ConfigContext): ExpoConfig => {
  // EAS Build sets APP_VARIANT for different build profiles
  // For local development, default to "development"
  const isProduction = process.env.APP_VARIANT === "production";

  return {
    ...config,
    name: "Cyd",
    slug: "cyd",
    version: packageJson.version,
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: ["social.cyd.api", "social.cyd.dev-api"],
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    platforms: ["android", "ios"],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "systems.lockdown.cyd-mobile",
      appleTeamId: "G762K6CH36",
      entitlements: {
        "aps-environment": isProduction ? "production" : "development",
      },
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        CFBundleURLTypes: [
          {
            CFBundleURLSchemes: ["social.cyd.api", "social.cyd.dev-api"],
          },
        ],
      },
      icon: "./assets/images/cyd.icon",
    },
    android: {
      versionCode: 3,
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      package: "systems.lockdown.cydmobile",
      googleServicesFile: "./google-services.json",
      intentFilters: [
        {
          action: "VIEW",
          data: [
            {
              scheme: "social.cyd.api",
            },
            {
              scheme: "social.cyd.dev-api",
            },
          ],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
    plugins: [
      "expo-router",
      [
        "expo-build-properties",
        {
          ios: {
            deploymentTarget: "15.5",
            useFrameworks: "static",
          },
          android: {
            enableProguardInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
          },
        },
      ],
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 300,
          resizeMode: "contain",
          backgroundColor: "#c3d1e4",
          android: {
            image: "./assets/images/splash-icon-android.png",
            imageWidth: 200,
          },
          dark: {
            backgroundColor: "#3a414b",
          },
        },
      ],
      "expo-video",
      [
        "expo-notifications",
        {
          icon: "./assets/images/notification-icon.png",
          color: "#4A90D9",
        },
      ],
      "expo-font",
      "@react-native-community/datetimepicker",
      "expo-image",
      "expo-localization",
      "expo-sharing",
      "expo-sqlite",
      "expo-web-browser",
      "./plugins/remove-android-permissions",
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: "192811c5-4578-4acb-b55d-4da9d2a5f44a",
      },
    },
    owner: "lockdownsystems",
  };
};

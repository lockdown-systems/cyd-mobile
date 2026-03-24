import "@/services/polyfills";

import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import "react-native-reanimated";

import { CydAccountBar } from "@/components/CydAccountBar";
import {
  OnboardingModal,
  useOnboardingModal,
} from "@/components/OnboardingModal";
import { CydAccountProvider } from "@/contexts/CydAccountProvider";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useNotificationHandler } from "@/hooks/use-notification-handler";
import { trackEvent } from "@/services/analytics";
import { PlausibleEvents } from "@/types/analytics";

function RootLayoutContent() {
  const colorScheme = useColorScheme();
  const segments = useSegments();
  const { visible, hideOnboarding, showOnboarding, hasChecked } =
    useOnboardingModal();

  // Set up notification handling
  useNotificationHandler();

  // Hide CydAccountBar when on the account detail screen
  const isAccountScreen = segments[0] === "account";

  useEffect(() => {
    // Track app opened event on initial load
    trackEvent(PlausibleEvents.APP_OPENED);
  }, []);

  // Wait for onboarding check to complete before rendering
  if (!hasChecked) {
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <View style={styles.container}>
        <View style={styles.content}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen
              name="account/[accountId]"
              options={{ headerShown: true }}
            />
            <Stack.Screen
              name="add-account"
              options={{ headerShown: true, presentation: "modal" }}
            />
          </Stack>
        </View>
        <CydAccountBar
          onShowOnboarding={showOnboarding}
          hidden={isAccountScreen}
        />
      </View>
      <OnboardingModal visible={visible} onClose={hideOnboarding} />
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <CydAccountProvider>
      <RootLayoutContent />
    </CydAccountProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});

import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import "react-native-reanimated";

import { CydAccountBar } from "@/components/CydAccountBar";
import { CydAccountProvider } from "@/contexts/CydAccountProvider";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useNotificationHandler } from "@/hooks/use-notification-handler";
import { trackEvent } from "@/services/analytics";
import { PlausibleEvents } from "@/types/analytics";

function RootLayoutContent() {
  const colorScheme = useColorScheme();

  // Set up notification handling
  useNotificationHandler();

  useEffect(() => {
    // Track app opened event on initial load
    trackEvent(PlausibleEvents.APP_OPENED);
  }, []);

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
        <CydAccountBar />
      </View>
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

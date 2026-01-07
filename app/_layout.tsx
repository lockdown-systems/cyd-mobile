import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import "react-native-reanimated";

import { CydAccountProvider } from "@/contexts/CydAccountProvider";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { trackEvent } from "@/services/analytics";
import { PlausibleEvents } from "@/types/analytics";

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    // Track app opened event on initial load
    trackEvent(PlausibleEvents.APP_OPENED);
  }, []);

  return (
    <CydAccountProvider>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
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
        <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      </ThemeProvider>
    </CydAccountProvider>
  );
}

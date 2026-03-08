import { useColorScheme as useRNColorScheme } from "react-native";

export type AppColorScheme = "light" | "dark";

export function useColorScheme(): AppColorScheme {
  const scheme = useRNColorScheme();

  // React Native can return null/unspecified; normalize to a concrete app theme.
  return scheme === "dark" ? "dark" : "light";
}

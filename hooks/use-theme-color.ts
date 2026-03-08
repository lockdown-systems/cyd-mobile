/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors, getThemePalette } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark,
) {
  const theme = useColorScheme();
  const colorFromProps = theme === "dark" ? props.dark : props.light;

  if (colorFromProps) {
    return colorFromProps;
  } else {
    const palette = getThemePalette(theme);
    return palette[colorName];
  }
}

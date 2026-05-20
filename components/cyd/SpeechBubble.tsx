import { useMemo } from "react";
import {
  Dimensions,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import Markdown, { type MarkdownProps } from "react-native-markdown-display";

import { getThemePalette } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { CydAvatar } from "./CydAvatar";

const SCREEN_HEIGHT = Dimensions.get("window").height;
const TARGET_HEIGHT = Math.min(SCREEN_HEIGHT / 3, 260);
const AVATAR_HEIGHT = Math.max(110, TARGET_HEIGHT * 0.65);
const TABLET_BREAKPOINT = 768;

type SpeechBubbleProps = {
  message: string;
  avatarHeight?: number;
  prominentOnTablet?: boolean;
};

export function SpeechBubble({
  message,
  avatarHeight,
  prominentOnTablet,
}: SpeechBubbleProps) {
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const palette = getThemePalette(colorScheme);
  const isProminentTablet = prominentOnTablet && width >= TABLET_BREAKPOINT;
  const bubbleBackground = colorScheme === "dark" ? "#202020ff" : "#f3f3f3";
  const bubbleBorder = colorScheme === "dark" ? "#404040" : "#e0e0e0";
  const markdownStyles = useMemo<MarkdownProps["style"]>(
    () => ({
      body: {
        fontSize: isProminentTablet ? 22 : 18,
        lineHeight: isProminentTablet ? 30 : 24,
        color: palette.text,
      },
      paragraph: {
        marginBottom: 8,
      },
      strong: {
        fontWeight: "700",
      },
      em: {
        fontStyle: "italic",
      },
      link: {
        color: palette.tint,
      },
    }),
    [isProminentTablet, palette.text, palette.tint],
  );

  const normalizedMessage = useMemo(() => {
    // Treat both literal "\n" sequences and actual newline characters as line breaks.
    const withActualBreaks = message
      .replace(/\\n/g, "\n")
      .replace(/\r\n?|\u2028|\u2029/g, "\n");

    // Preserve blank lines (paragraph breaks) while converting single newlines into
    // Markdown hard-break syntax so SpeechBubble callers can rely on "\n" for layout.
    return withActualBreaks
      .split("\n\n")
      .map((paragraph) => paragraph.replace(/\n/g, "  \n"))
      .join("\n\n");
  }, [message]);

  return (
    <View
      style={[styles.wrapper, isProminentTablet && styles.prominentWrapper]}
      accessibilityRole="text"
    >
      <CydAvatar
        height={avatarHeight ?? AVATAR_HEIGHT}
        style={[styles.avatar, isProminentTablet && styles.prominentAvatar]}
      />
      <View
        style={[
          styles.bubble,
          isProminentTablet && styles.prominentBubble,
          {
            backgroundColor: bubbleBackground,
            borderColor: bubbleBorder,
          },
        ]}
      >
        <Markdown key={normalizedMessage} style={markdownStyles}>
          {normalizedMessage}
        </Markdown>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
    paddingVertical: 0,
    marginBottom: 12,
    marginLeft: 0,
  },
  prominentWrapper: {
    marginBottom: 20,
  },
  avatar: {
    flexShrink: 0,
    marginLeft: -30,
    marginRight: -5,
  },
  prominentAvatar: {
    marginLeft: -18,
    marginRight: 8,
  },
  bubble: {
    flex: 1,
    alignSelf: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderTopRightRadius: 32,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    borderTopLeftRadius: 8,
    paddingTop: 5,
    paddingBottom: 10,
    paddingHorizontal: 20,
    justifyContent: "center",
  },
  prominentBubble: {
    borderTopRightRadius: 36,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    borderTopLeftRadius: 10,
    paddingTop: 12,
    paddingBottom: 16,
    paddingHorizontal: 28,
  },
});

export default SpeechBubble;

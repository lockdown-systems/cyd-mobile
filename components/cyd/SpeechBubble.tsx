import { useMemo } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import Markdown, { type MarkdownProps } from "react-native-markdown-display";

import { getThemePalette } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { CydAvatar } from "./CydAvatar";

const SCREEN_HEIGHT = Dimensions.get("window").height;
const TARGET_HEIGHT = Math.min(SCREEN_HEIGHT / 3, 260);
const AVATAR_HEIGHT = Math.max(110, TARGET_HEIGHT * 0.65);

type SpeechBubbleProps = {
  message: string;
};

export function SpeechBubble({ message }: SpeechBubbleProps) {
  const colorScheme = useColorScheme();
  const palette = getThemePalette(colorScheme);
  const bubbleBackground = colorScheme === "dark" ? "#202020ff" : "#f3f3f3";
  const bubbleBorder = colorScheme === "dark" ? "#404040" : "#e0e0e0";
  const markdownStyles = useMemo<MarkdownProps["style"]>(
    () => ({
      body: {
        fontSize: 18,
        lineHeight: 24,
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
    [palette.text, palette.tint],
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
    <View style={styles.wrapper} accessibilityRole="text">
      <CydAvatar height={AVATAR_HEIGHT} style={styles.avatar} />
      <View
        style={[
          styles.bubble,
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
  avatar: {
    flexShrink: 0,
    marginLeft: -30,
    marginRight: -5,
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
});

export default SpeechBubble;

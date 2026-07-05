import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dimensions,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Markdown, { type MarkdownProps } from "react-native-markdown-display";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CydAvatar } from "@/components/cyd/CydAvatar";
import { getThemePalette } from "@/constants/theme";
import {
  hasOnboardingBeenShown,
  setOnboardingShown,
} from "@/database/onboarding";
import { useColorScheme } from "@/hooks/use-color-scheme";

const SCREEN_HEIGHT = Dimensions.get("window").height;
const AVATAR_HEIGHT = Math.min(SCREEN_HEIGHT * 0.2, 280);
const TABLET_BREAKPOINT = 768;
const TABLET_CONTENT_MAX_WIDTH = 720;
const TABLET_BUTTONS_MAX_WIDTH = 520;
const TABLET_MODAL_VERTICAL_PADDING = 150;

type OnboardingModalProps = {
  visible: boolean;
  onClose: () => void;
};

const ONBOARDING_SCREENS = [
  {
    content: `**Hello, friend! I'm Cyd -- short for Clawback Your Data.**

Most tech platforms are controlled by a tiny group of powerful billionaires. You don't _owe_ them your data. Even posting to Bluesky is a privacy nightmare.

We go out of our way to protect our privacy. We use ad blockers to fight surveillance capitalists. We use Signal to keep our chats private.

_Why should everything you post to social media stay online, and public, forever?_`,
  },
  {
    content: `With this app, you can:

**Create a local, private backup of your data**, including Bluesky posts, reposts, likes, bookmarks, and chat messages.

**Choose what you want to delete.** You can delete it all, or you can be selective, deleting most of it but keeping what went viral.

**Schedule automatic deletion**, keeping your online data as ephemeral as you want over time.`,
  },
  {
    content: `**We can't access your accounts or your data.**

Cyd runs directly on your device, not on our servers.

Cyd is designed so that we don't have access to your accounts, or to any of your data in those accounts. We don't even record what your username is.

When you sign into a Bluesky account in Cyd, you grant the app running locally on your phone permission to access it, not us, the developers of the app.

Cyd is [open source](https://github.com/lockdown-systems/cyd-mobile).`,
  },
  {
    content: `**Delete Bluesky data with this app.**

The mobile version of Cyd only supports Bluesky. This is possible because Bluesky uses an open protocol and is developer-friendly.

**Delete X (Twitter) data with the Cyd desktop app.**

If you want to delete your data on enshittified platforms like X (and, soon, Facebook), you need to use the desktop version of Cyd. Download it from your computer at [cyd.social](https://cyd.social).`,
  },
];

export function OnboardingModal({ visible, onClose }: OnboardingModalProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const palette = getThemePalette(colorScheme);
  const [currentPage, setCurrentPage] = useState(0);
  const isTablet = width >= TABLET_BREAKPOINT;

  const markdownStyles = useMemo<MarkdownProps["style"]>(
    () => ({
      body: {
        fontSize: 20,
        lineHeight: 28,
        color: palette.text,
      },
      paragraph: {
        marginBottom: 20,
        marginTop: 0,
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

  // Reset to first page when modal opens. Adjusting state during render (per
  // React docs) instead of a synchronous setState in an effect.
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (visible) {
      setCurrentPage(0);
    }
  }

  const handleContinue = useCallback(() => {
    if (currentPage < ONBOARDING_SCREENS.length - 1) {
      setCurrentPage(currentPage + 1);
    } else {
      void setOnboardingShown(true);
      onClose();
    }
  }, [currentPage, onClose]);

  const handleBack = useCallback(() => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1);
    }
  }, [currentPage]);

  const handleClose = useCallback(() => {
    setCurrentPage(0);
    onClose();
  }, [onClose]);

  const isFirstPage = currentPage === 0;
  const isLastPage = currentPage === ONBOARDING_SCREENS.length - 1;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="overFullScreen"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View
        style={[
          styles.container,
          {
            backgroundColor: palette.background,
            paddingTop: insets.top + (isTablet ? 32 : 16),
            paddingBottom: insets.bottom + (isTablet ? 24 : 8),
          },
        ]}
      >
        <View
          style={[styles.contentShell, isTablet && styles.tabletContentShell]}
        >
          <View style={styles.avatarContainer}>
            <CydAvatar height={AVATAR_HEIGHT} />
          </View>

          <ScrollView
            style={styles.contentContainer}
            contentContainerStyle={[
              styles.contentContainerInner,
              isTablet && styles.tabletContentContainerInner,
            ]}
            showsVerticalScrollIndicator={false}
          >
            <Markdown
              style={markdownStyles}
              onLinkPress={(url) => {
                void Linking.openURL(url);
                return false;
              }}
            >
              {ONBOARDING_SCREENS[currentPage].content}
            </Markdown>
          </ScrollView>

          <View
            style={[
              styles.buttonContainer,
              isTablet && styles.tabletButtonContainer,
            ]}
          >
            {!isFirstPage && (
              <Pressable
                onPress={handleBack}
                style={({ pressed }) => [
                  styles.button,
                  styles.secondaryButton,
                  {
                    borderColor: palette.icon + "44",
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Back"
              >
                <Text style={[styles.buttonText, { color: palette.text }]}>
                  Back
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={handleContinue}
              style={({ pressed }) => [
                styles.button,
                styles.primaryButton,
                {
                  backgroundColor: palette.button.background,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={isLastPage ? "Finish" : "Continue"}
            >
              <Text style={[styles.buttonText, { color: palette.button.text }]}>
                {isLastPage ? "Finish" : "Continue"}
              </Text>
            </Pressable>
          </View>

          <View style={styles.dotsContainer}>
            {ONBOARDING_SCREENS.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      index === currentPage
                        ? palette.tint
                        : palette.icon + "44",
                  },
                ]}
              />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function useOnboardingModal() {
  const [visible, setVisible] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    void hasOnboardingBeenShown().then((shown) => {
      setHasChecked(true);
      if (!shown) {
        setVisible(true);
      }
    });
  }, []);

  const showOnboarding = useCallback(() => {
    setVisible(true);
  }, []);

  const hideOnboarding = useCallback(() => {
    setVisible(false);
  }, []);

  return {
    visible,
    hasChecked,
    showOnboarding,
    hideOnboarding,
  };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  contentShell: {
    flex: 1,
    width: "100%",
  },
  tabletContentShell: {
    maxWidth: TABLET_CONTENT_MAX_WIDTH,
    paddingTop: TABLET_MODAL_VERTICAL_PADDING,
    paddingBottom: TABLET_MODAL_VERTICAL_PADDING,
  },
  avatarContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  contentContainer: {
    flex: 1,
  },
  contentContainerInner: {
    flexGrow: 1,
  },
  tabletContentContainerInner: {
    paddingVertical: 16,
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
    width: "100%",
  },
  tabletButtonContainer: {
    maxWidth: TABLET_BUTTONS_MAX_WIDTH,
    alignSelf: "center",
  },
  button: {
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  primaryButton: {
    flex: 2,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dotsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

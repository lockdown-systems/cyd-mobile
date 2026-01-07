import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { CydSignInModal } from "@/components/CydSignInModal";
import { CydAvatar } from "@/components/cyd/CydAvatar";
import { useCydAccount } from "@/contexts/CydAccountProvider";
import type { AccountTabPalette } from "@/types/account-tabs";

type PremiumRequiredBannerProps = {
  palette: AccountTabPalette;
};

export function PremiumRequiredBanner({ palette }: PremiumRequiredBannerProps) {
  const { state: cydState, apiClient, getDashboardURL } = useCydAccount();
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [hasPremium, setHasPremium] = useState<boolean | null>(null);
  const [checkingPremium, setCheckingPremium] = useState(false);

  const checkPremiumAccess = useCallback(async () => {
    if (!cydState.isSignedIn) {
      setHasPremium(null);
      return;
    }
    setCheckingPremium(true);
    try {
      const response = await apiClient.getUserPremium();
      if ("error" in response) {
        setHasPremium(false);
      } else {
        setHasPremium(response.premium_access);
      }
    } catch {
      setHasPremium(false);
    } finally {
      setCheckingPremium(false);
    }
  }, [cydState.isSignedIn, apiClient]);

  useEffect(() => {
    void checkPremiumAccess();
  }, [checkPremiumAccess]);

  const handleManageAccount = useCallback(() => {
    const url = getDashboardURL();
    void Linking.openURL(url).catch(() => {
      Alert.alert("Error", "Could not open browser.");
    });
  }, [getDashboardURL]);

  const handleIveUpgraded = useCallback(() => {
    setCheckingPremium(true);
    void (async () => {
      try {
        const response = await apiClient.getUserPremium();
        if ("error" in response) {
          Alert.alert(
            "Error",
            "Could not check your account status. Please try again."
          );
          return;
        }
        setHasPremium(response.premium_access);
        if (response.premium_access) {
          Alert.alert("Success", "You now have Premium access!");
        } else {
          Alert.alert(
            "Not Yet",
            "Your account doesn't have Premium access yet. Please complete your upgrade and try again."
          );
        }
      } catch {
        Alert.alert(
          "Error",
          "Could not check your account status. Please try again."
        );
      } finally {
        setCheckingPremium(false);
      }
    })();
  }, [apiClient]);

  // Loading state while checking premium
  if (cydState.isLoading || checkingPremium) {
    return (
      <View
        style={[
          styles.banner,
          {
            borderColor: palette.icon + "22",
            backgroundColor: palette.card,
          },
        ]}
      >
        <View style={styles.avatarContainer}>
          <CydAvatar height={100} />
        </View>
        <View style={styles.contentContainer}>
          <ActivityIndicator color={palette.tint} size="small" />
          <Text style={[styles.statusText, { color: palette.icon }]}>
            Checking account status…
          </Text>
        </View>
      </View>
    );
  }

  // User is not signed in
  if (!cydState.isSignedIn) {
    return (
      <>
        <View
          style={[
            styles.banner,
            {
              borderColor: palette.tint + "44",
              backgroundColor: palette.tint + "11",
            },
          ]}
        >
          <View style={styles.topRow}>
            <View style={styles.avatarContainer}>
              <CydAvatar height={100} />
            </View>
            <View style={styles.contentContainer}>
              <Text style={[styles.messageText, { color: palette.text }]}>
                Deleting data requires a Premium account. Sign in to get
                started.
              </Text>
              <View style={styles.buttonColumn}>
                <Pressable
                  onPress={() => setShowSignInModal(true)}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    {
                      backgroundColor:
                        palette.button?.background ?? palette.tint,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.primaryButtonText,
                      { color: palette.button?.text ?? "#ffffff" },
                    ]}
                  >
                    Sign In
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
          <Text style={[styles.hintText, { color: palette.icon }]}>
            In the meantime, feel free to explore the delete features below.
          </Text>
        </View>
        <CydSignInModal
          visible={showSignInModal}
          onClose={() => setShowSignInModal(false)}
        />
      </>
    );
  }

  // User is signed in but doesn't have premium
  if (hasPremium === false) {
    return (
      <View
        style={[
          styles.banner,
          {
            borderColor: palette.tint + "44",
            backgroundColor: palette.tint + "11",
          },
        ]}
      >
        <View style={styles.topRow}>
          <View style={styles.avatarContainer}>
            <CydAvatar height={100} />
          </View>
          <View style={styles.contentContainer}>
            <Text style={[styles.messageText, { color: palette.text }]}>
              Deleting data requires a Premium account. Manage your account to
              upgrade to Premium.
            </Text>
            <View style={styles.buttonColumn}>
              <Pressable
                onPress={handleManageAccount}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: palette.button?.background ?? palette.tint,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.primaryButtonText,
                    { color: palette.button?.text ?? "#ffffff" },
                  ]}
                >
                  Manage My Account
                </Text>
              </Pressable>
              <Pressable
                onPress={handleIveUpgraded}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  {
                    borderColor: palette.icon + "33",
                    backgroundColor: palette.card,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
                accessibilityRole="button"
              >
                <Text
                  style={[styles.secondaryButtonText, { color: palette.text }]}
                >
                  I&apos;ve Upgraded
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
        <Text style={[styles.hintText, { color: palette.icon }]}>
          In the meantime, feel free to explore the delete features below.
        </Text>
      </View>
    );
  }

  // User has premium - show nothing
  return null;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "column",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 12,
    gap: 12,
    marginBottom: 20,
  },
  topRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  avatarContainer: {
    flexShrink: 0,
    width: 100,
    height: 100,
  },
  contentContainer: {
    flex: 1,
    gap: 12,
  },
  statusText: {
    fontSize: 15,
    textAlign: "center",
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },
  hintText: {
    fontSize: 13,
    lineHeight: 18,
  },
  buttonColumn: {
    gap: 8,
  },
  primaryButton: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  secondaryButton: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
});

export default PremiumRequiredBanner;

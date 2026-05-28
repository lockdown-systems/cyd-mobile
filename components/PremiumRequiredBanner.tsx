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
  const {
    state: cydState,
    premiumUpsellMode,
    appStorePurchaseState,
    getDashboardURL,
    checkPremiumAccess,
    purchasePremium,
    restoreAppStorePurchases,
  } = useCydAccount();
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [checkingPremium, setCheckingPremium] = useState(false);

  // Check premium access on mount if not already checked
  useEffect(() => {
    if (cydState.isSignedIn && cydState.hasPremiumAccess === null) {
      void checkPremiumAccess();
    }
  }, [cydState.isSignedIn, cydState.hasPremiumAccess, checkPremiumAccess]);

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
        await checkPremiumAccess();
        // Re-read from context after refresh - need a small delay for state to update
        // We'll show success/failure based on the next render
        setCheckingPremium(false);
      } catch {
        Alert.alert(
          "Error",
          "Could not check your account status. Please try again.",
        );
        setCheckingPremium(false);
      }
    })();
  }, [checkPremiumAccess]);

  const handleSubscribeWithApple = useCallback(() => {
    void (async () => {
      const result = await purchasePremium();
      if (!result.success && result.error) {
        Alert.alert("Purchase Failed", result.error);
      }
    })();
  }, [purchasePremium]);

  const handleRestorePurchases = useCallback(() => {
    void (async () => {
      const result = await restoreAppStorePurchases();
      if (!result.success && result.error) {
        Alert.alert("Restore Failed", result.error);
      }
    })();
  }, [restoreAppStorePurchases]);

  // Loading state while checking premium (only show if actively checking, not on initial load)
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
  if (cydState.hasPremiumAccess === false) {
    const usesAppStoreIAP = premiumUpsellMode === "app_store_iap";
    const appStorePrice = appStorePurchaseState?.product?.displayPrice;
    const appStoreBusy = Boolean(
      appStorePurchaseState?.isPurchasing || appStorePurchaseState?.isRestoring,
    );
    const appStorePrimaryLabel = appStorePurchaseState?.isPurchasing
      ? "Purchasing…"
      : appStorePurchaseState?.isLoadingProduct
        ? "Loading Subscription…"
        : appStorePrice
          ? `Subscribe ${appStorePrice}/year`
          : "Subscribe with Apple";

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
              {usesAppStoreIAP
                ? "Deleting data requires a Premium account. Subscribe with your Apple ID to upgrade to Premium."
                : "Deleting data requires a Premium account. Manage your account to upgrade to Premium."}
            </Text>
            <View style={styles.buttonColumn}>
              {usesAppStoreIAP ? (
                <>
                  <Pressable
                    onPress={handleSubscribeWithApple}
                    disabled={
                      appStoreBusy || appStorePurchaseState?.isLoadingProduct
                    }
                    style={({ pressed }) => [
                      styles.primaryButton,
                      {
                        backgroundColor:
                          palette.button?.background ?? palette.tint,
                        opacity:
                          pressed &&
                          !appStoreBusy &&
                          !appStorePurchaseState?.isLoadingProduct
                            ? 0.85
                            : appStoreBusy ||
                                appStorePurchaseState?.isLoadingProduct
                              ? 0.6
                              : 1,
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
                      {appStorePrimaryLabel}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleRestorePurchases}
                    disabled={appStoreBusy}
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      {
                        borderColor: palette.icon + "33",
                        backgroundColor: palette.card,
                        opacity:
                          pressed && !appStoreBusy
                            ? 0.85
                            : appStoreBusy
                              ? 0.6
                              : 1,
                      },
                    ]}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        styles.secondaryButtonText,
                        { color: palette.text },
                      ]}
                    >
                      {appStorePurchaseState?.isRestoring
                        ? "Restoring…"
                        : "Restore Purchases"}
                    </Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable
                    onPress={handleManageAccount}
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
                      style={[
                        styles.secondaryButtonText,
                        { color: palette.text },
                      ]}
                    >
                      I&apos;ve Upgraded
                    </Text>
                  </Pressable>
                </>
              )}
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

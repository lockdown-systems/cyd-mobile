import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { CydSignInModal } from "@/components/CydSignInModal";
import { CydAvatar } from "@/components/cyd/CydAvatar";
import { useCydAccount } from "@/contexts/CydAccountProvider";
import type { AccountTabPalette } from "@/types/account-tabs";

type PremiumRequiredModalProps = {
  visible: boolean;
  palette: AccountTabPalette;
  onDismiss: () => void;
  onPremiumConfirmed: () => void;
};

export function PremiumRequiredModal({
  visible,
  palette,
  onDismiss,
  onPremiumConfirmed,
}: PremiumRequiredModalProps) {
  const {
    state: cydState,
    getDashboardURL,
    checkPremiumAccess,
  } = useCydAccount();
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [checkingPremium, setCheckingPremium] = useState(false);

  // Check premium status when modal becomes visible (only if not already checked)
  useEffect(() => {
    if (visible && cydState.isSignedIn && cydState.hasPremiumAccess === null) {
      void checkPremiumAccess();
    }
  }, [
    visible,
    cydState.isSignedIn,
    cydState.hasPremiumAccess,
    checkPremiumAccess,
  ]);

  // If user has premium and modal is visible, trigger the callback
  useEffect(() => {
    if (visible && cydState.hasPremiumAccess === true) {
      onPremiumConfirmed();
    }
  }, [visible, cydState.hasPremiumAccess, onPremiumConfirmed]);

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
        // The useEffect above will call onPremiumConfirmed if hasPremiumAccess becomes true
        // We just need to show appropriate feedback
        setCheckingPremium(false);
      } catch {
        Alert.alert(
          "Error",
          "Could not check your account status. Please try again."
        );
        setCheckingPremium(false);
      }
    })();
  }, [checkPremiumAccess]);

  // Show alert when premium status changes after clicking "I've Upgraded"
  useEffect(() => {
    if (!checkingPremium && cydState.hasPremiumAccess === false) {
      // Only show "Not Yet" if user just checked (checkingPremium was true)
      // This is handled by the flow - no alert needed on initial render
    }
  }, [checkingPremium, cydState.hasPremiumAccess]);

  const handleSignInClose = useCallback(() => {
    setShowSignInModal(false);
    // Re-check premium after sign-in modal closes
    void checkPremiumAccess();
  }, [checkPremiumAccess]);

  const renderContent = () => {
    // Loading state while checking premium
    if (cydState.isLoading || checkingPremium) {
      return (
        <View style={styles.contentContainer}>
          <ActivityIndicator color={palette.tint} size="large" />
          <Text style={[styles.statusText, { color: palette.icon }]}>
            Checking account status…
          </Text>
        </View>
      );
    }

    // User is not signed in
    if (!cydState.isSignedIn) {
      return (
        <>
          <View style={styles.contentContainer}>
            <Text style={[styles.messageText, { color: palette.text }]}>
              Deleting data requires a Premium account. Sign in to get started.
            </Text>
            <View style={styles.buttonColumn}>
              <Pressable
                onPress={() => setShowSignInModal(true)}
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
                  Sign In
                </Text>
              </Pressable>
            </View>
          </View>
          <CydSignInModal
            visible={showSignInModal}
            onClose={handleSignInClose}
          />
        </>
      );
    }

    // User is signed in but doesn't have premium
    return (
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
            <Text style={[styles.secondaryButtonText, { color: palette.text }]}>
              I&apos;ve Upgraded
            </Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.modalContainer,
            {
              backgroundColor: palette.background,
              borderColor: palette.icon + "22",
            },
          ]}
        >
          <View style={styles.avatarContainer}>
            <CydAvatar height={120} />
          </View>
          <Text style={[styles.title, { color: palette.text }]}>
            Premium Required
          </Text>
          {renderContent()}
          <Pressable
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.dismissButton,
              {
                borderColor: palette.icon + "33",
                opacity: pressed ? 0.85 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <Text style={[styles.dismissButtonText, { color: palette.icon }]}>
              Cancel
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContainer: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    alignItems: "center",
    gap: 16,
  },
  avatarContainer: {
    width: 120,
    height: 120,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  contentContainer: {
    width: "100%",
    gap: 16,
    alignItems: "center",
  },
  statusText: {
    fontSize: 15,
    textAlign: "center",
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
  },
  buttonColumn: {
    width: "100%",
    gap: 8,
  },
  primaryButton: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  dismissButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  dismissButtonText: {
    fontSize: 14,
    fontWeight: "500",
  },
});

export default PremiumRequiredModal;

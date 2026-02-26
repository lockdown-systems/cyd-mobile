import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { Colors } from "@/constants/theme";
import { useCydAccount } from "@/contexts/CydAccountProvider";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useModalBottomPadding } from "@/hooks/use-modal-bottom-padding";

type SignInModalProps = {
  visible: boolean;
  onClose: () => void;
};

type SignInStep = "email" | "verification" | "loading";

export function CydSignInModal({ visible, onClose }: SignInModalProps) {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const modalBottomPadding = useModalBottomPadding({ minPadding: 16 });
  const { sendVerificationCode, signIn } = useCydAccount();

  const [step, setStep] = useState<SignInStep>("email");
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [subscribeToNewsletter, setSubscribeToNewsletter] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const verificationInputRef = useRef<TextInput>(null);

  const resetState = useCallback(() => {
    setStep("email");
    setEmail("");
    setVerificationCode("");
    setSubscribeToNewsletter(true);
    setError(null);
    setIsLoading(false);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const handleSendCode = useCallback(() => {
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    setIsLoading(true);
    setError(null);

    void sendVerificationCode(email.trim()).then((result) => {
      setIsLoading(false);

      if (result.success) {
        setStep("verification");
        // Focus the verification code input after a short delay
        setTimeout(() => {
          verificationInputRef.current?.focus();
        }, 100);
      } else {
        setError(result.error ?? "Failed to send verification code.");
      }
    });
  }, [email, sendVerificationCode]);

  const handleVerifyCode = useCallback(
    async (code: string) => {
      if (code.length !== 6) {
        return;
      }

      setIsLoading(true);
      setError(null);

      const result = await signIn(email.trim(), code, subscribeToNewsletter);

      setIsLoading(false);

      if (result.success) {
        handleClose();
      } else {
        setError(result.error ?? "Invalid verification code.");
        setVerificationCode("");
      }
    },
    [email, subscribeToNewsletter, signIn, handleClose],
  );

  const handleVerificationCodeChange = useCallback(
    (text: string) => {
      // Only allow digits
      const filtered = text.replace(/[^0-9]/g, "").slice(0, 6);
      setVerificationCode(filtered);

      // Auto-submit when 6 digits are entered
      if (filtered.length === 6) {
        void handleVerifyCode(filtered);
      }
    },
    [handleVerifyCode],
  );

  const handleGoBack = useCallback(() => {
    setStep("email");
    setVerificationCode("");
    setError(null);
  }, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[
          styles.container,
          {
            backgroundColor: palette.background,
            paddingBottom: modalBottomPadding,
          },
        ]}
      >
        <View style={styles.header}>
          <Pressable onPress={handleClose} style={styles.closeButton}>
            <Text style={[styles.closeButtonText, { color: palette.tint }]}>
              Cancel
            </Text>
          </Pressable>
          <Text style={[styles.title, { color: palette.text }]}>
            Sign in to Cyd
          </Text>
          <View style={styles.closeButton} />
        </View>

        <View style={styles.content}>
          {step === "email" && (
            <View style={styles.stepContainer}>
              <Text style={[styles.description, { color: palette.icon }]}>
                Sign in to your Cyd account to access premium features.
              </Text>

              <View style={styles.inputContainer}>
                <Text style={[styles.label, { color: palette.text }]}>
                  Email Address
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: palette.card,
                      borderColor: palette.icon + "33",
                      color: palette.text,
                    },
                  ]}
                  placeholder="you@example.com"
                  placeholderTextColor={palette.icon + "88"}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  editable={!isLoading}
                />
              </View>

              <View style={styles.switchRow}>
                <Text style={[styles.switchLabel, { color: palette.text }]}>
                  Subscribe to occasional email updates from Lockdown System,
                  the collective that makes Cyd
                </Text>
                <View style={styles.switchControl}>
                  <Switch
                    value={subscribeToNewsletter}
                    onValueChange={setSubscribeToNewsletter}
                    trackColor={{
                      false: palette.icon + "33",
                      true: palette.tint + "88",
                    }}
                    thumbColor={
                      subscribeToNewsletter ? palette.tint : "#f4f3f4"
                    }
                    disabled={isLoading}
                  />
                </View>
              </View>

              {error ? (
                <Text style={[styles.errorText, { color: "#e53935" }]}>
                  {error}
                </Text>
              ) : null}

              <Pressable
                onPress={handleSendCode}
                disabled={isLoading}
                style={({ pressed }) => [
                  styles.button,
                  {
                    backgroundColor: palette.button.background,
                    opacity: isLoading ? 0.6 : pressed ? 0.9 : 1,
                  },
                ]}
              >
                {isLoading ? (
                  <ActivityIndicator color={palette.button.text} />
                ) : (
                  <Text
                    style={[styles.buttonText, { color: palette.button.text }]}
                  >
                    Continue
                  </Text>
                )}
              </Pressable>

              <Text style={[styles.privacyText, { color: palette.icon }]}>
                Your email address will be used to identify your account. We
                won&apos;t share it or send you unsoliciated emails.
              </Text>
            </View>
          )}

          {step === "verification" && (
            <View style={styles.stepContainer}>
              <Text style={[styles.description, { color: palette.icon }]}>
                A verification code was sent to{" "}
                <Text style={{ fontWeight: "600", color: palette.text }}>
                  {email}
                </Text>
                . Enter it below.
              </Text>

              <View style={styles.inputContainer}>
                <Text style={[styles.label, { color: palette.text }]}>
                  Verification Code
                </Text>
                <TextInput
                  ref={verificationInputRef}
                  style={[
                    styles.input,
                    styles.codeInput,
                    {
                      backgroundColor: palette.card,
                      borderColor: palette.icon + "33",
                      color: palette.text,
                    },
                  ]}
                  placeholder="000000"
                  placeholderTextColor={palette.icon + "88"}
                  value={verificationCode}
                  onChangeText={handleVerificationCodeChange}
                  keyboardType="number-pad"
                  maxLength={6}
                  editable={!isLoading}
                  autoFocus
                />
              </View>

              {error ? (
                <Text style={[styles.errorText, { color: "#e53935" }]}>
                  {error}
                </Text>
              ) : null}

              {isLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator color={palette.tint} />
                  <Text style={[styles.loadingText, { color: palette.icon }]}>
                    Signing in...
                  </Text>
                </View>
              ) : null}

              <Pressable
                onPress={handleGoBack}
                disabled={isLoading}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  {
                    borderColor: palette.icon + "33",
                    opacity: isLoading ? 0.6 : pressed ? 0.9 : 1,
                  },
                ]}
              >
                <Text
                  style={[styles.secondaryButtonText, { color: palette.text }]}
                >
                  Back
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  closeButton: {
    width: 60,
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: "500",
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  stepContainer: {
    gap: 20,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  inputContainer: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    letterSpacing: 0,
  },
  codeInput: {
    fontSize: 24,
    letterSpacing: 8,
    textAlign: "center",
    fontWeight: "600",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 8,
  },
  switchLabel: {
    flex: 1,
    fontSize: 15,
    marginRight: 12,
  },
  switchControl: {
    paddingTop: 2,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  button: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "500",
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
  },
  privacyText: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 16,
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
  },
});

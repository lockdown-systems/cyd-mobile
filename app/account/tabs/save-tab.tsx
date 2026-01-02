import { MaterialIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AutomationModal } from "@/app/account/components/AutomationModal";
import type { SaveJobOptions } from "@/controllers/bluesky/job-types";
import type { AccountSaveSettings } from "@/database/save-settings";
import {
  getAccountSaveSettings,
  updateAccountSaveSettings,
} from "@/database/save-settings";
import type { AccountTabPalette, AccountTabProps } from "@/types/account-tabs";

type SaveFlowScreen = "form" | "review";

const SAVE_OPTION_DEFINITIONS = [
  {
    key: "posts",
    label: "Save my posts",
    reviewLabel: "Save posts",
  },
  {
    key: "likes",
    label: "Save my likes",
    reviewLabel: "Save likes",
  },
  {
    key: "bookmarks",
    label: "Save my bookmarks",
    reviewLabel: "Save bookmarks",
  },
  {
    key: "chat",
    label: "Save my chat messages",
    reviewLabel: "Save chat messages",
  },
] as const;

type SaveOptionKey = (typeof SAVE_OPTION_DEFINITIONS)[number]["key"];
type SaveOptionState = Record<SaveOptionKey, boolean>;

const DEFAULT_STATE: SaveOptionState = {
  posts: true,
  likes: true,
  bookmarks: true,
  chat: false,
};

function mapSettingsToState(settings: AccountSaveSettings): SaveOptionState {
  return {
    posts: settings.posts,
    likes: settings.likes,
    bookmarks: settings.bookmarks,
    chat: settings.chat,
  };
}

function mapStateToJobOptions(state: SaveOptionState): SaveJobOptions {
  return {
    posts: state.posts,
    likes: state.likes,
    bookmarks: state.bookmarks,
    chat: state.chat,
  };
}

export function SaveTab({
  accountId,
  accountUUID,
  handle,
  palette,
  onSelectTab,
}: AccountTabProps) {
  const [screenStack, setScreenStack] = useState<SaveFlowScreen[]>(["form"]);
  const [state, setState] = useState<SaveOptionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [automationVisible, setAutomationVisible] = useState(false);
  const [automationOptions, setAutomationOptions] =
    useState<SaveOptionState | null>(null);
  const [automationKey, setAutomationKey] = useState(0);

  const selectedOptions = useMemo(() => {
    if (!state) {
      return [];
    }
    return SAVE_OPTION_DEFINITIONS.filter((option) => state[option.key]);
  }, [state]);

  const canContinue = Boolean(
    !loading && !error && state && selectedOptions.length > 0
  );

  const currentScreen = screenStack[screenStack.length - 1];

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPersistError(null);
    setSaving(false);
    try {
      const settings = await getAccountSaveSettings(accountId);
      setState(mapSettingsToState(settings));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setState({ ...DEFAULT_STATE });
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    let cancelled = false;
    setScreenStack(["form"]);
    setState(null);
    setError(null);
    setPersistError(null);
    setSaving(false);
    setLoading(true);
    setAutomationVisible(false);
    setAutomationOptions(null);

    console.log("[SaveTab] load settings -> start", accountId);

    void (async () => {
      try {
        const settings = await getAccountSaveSettings(accountId);
        if (!cancelled) {
          setState(mapSettingsToState(settings));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setState({ ...DEFAULT_STATE });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          console.log("[SaveTab] load settings -> done", accountId);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const pushScreen = useCallback(
    (next: SaveFlowScreen) => {
      console.log("[SaveTab] push screen", accountId, next);
      setScreenStack((prev) => [...prev, next]);
    },
    [accountId]
  );

  const popScreen = useCallback(() => {
    console.log("[SaveTab] pop screen", accountId);
    setScreenStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, [accountId]);

  const resetToForm = useCallback(() => {
    console.log("[SaveTab] reset to form", accountId);
    setScreenStack(["form"]);
    setPersistError(null);
    setSaving(false);
  }, [accountId]);

  const handleToggle = useCallback((key: SaveOptionKey) => {
    setPersistError(null);
    setState((prev) => (prev ? { ...prev, [key]: !prev[key] } : prev));
  }, []);

  const handleContinue = useCallback(async () => {
    if (!canContinue || !state) {
      return;
    }
    console.log("[SaveTab] continue -> start", accountId);
    setSaving(true);
    setPersistError(null);
    try {
      await updateAccountSaveSettings(accountId, state);
      pushScreen("review");
      console.log("[SaveTab] continue -> review", accountId);
    } catch (err) {
      console.error("Failed to update save settings", err);
      setPersistError("Failed to save your selections. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [accountId, canContinue, state, pushScreen]);

  const handleConfirm = useCallback(() => {
    if (!state) return;
    console.log("[SaveTab] confirm automation", accountId);
    setAutomationOptions(state);
    setAutomationKey((prev) => prev + 1); // Force new modal instance
    setAutomationVisible(true);
  }, [accountId, state]);

  return (
    <View style={styles.container}>
      {currentScreen === "form" && (
        <SaveOptionsForm
          handle={handle}
          palette={palette}
          state={state}
          loading={loading}
          error={error}
          onRetry={loadSettings}
          onToggle={handleToggle}
          onContinue={handleContinue}
          canContinue={canContinue}
          saving={saving}
          persistError={persistError}
        />
      )}
      {currentScreen === "review" && state && (
        <SaveReviewScreen
          palette={palette}
          selections={state}
          onBack={popScreen}
          onConfirm={handleConfirm}
        />
      )}
      <AutomationModal
        key={automationKey}
        visible={automationVisible}
        accountId={accountId}
        accountUUID={accountUUID}
        palette={palette}
        options={mapStateToJobOptions(
          automationOptions ?? state ?? DEFAULT_STATE
        )}
        onFinished={(result) => {
          if (result === "completed") {
            onSelectTab?.("dashboard");
          }
        }}
        onClose={() => {
          setAutomationVisible(false);
        }}
        onRestart={() => {
          setAutomationVisible(false);
          resetToForm();
        }}
      />
    </View>
  );
}

type SaveOptionsFormProps = {
  handle: string;
  palette: AccountTabPalette;
  state: SaveOptionState | null;
  loading: boolean;
  error: Error | null;
  canContinue: boolean;
  onRetry: () => void | Promise<void>;
  onToggle: (key: SaveOptionKey) => void;
  onContinue: () => void | Promise<void>;
  saving: boolean;
  persistError: string | null;
};

function SaveOptionsForm({
  handle,
  palette,
  state,
  loading,
  error,
  canContinue,
  onRetry,
  onToggle,
  onContinue,
  saving,
  persistError,
}: SaveOptionsFormProps) {
  return (
    <View style={styles.stackScreen}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.headline, { color: palette.text }]}>
          Choose what to save
        </Text>
        <Text style={[styles.subhead, { color: palette.icon }]}>
          What data would you like Cyd to archive?
        </Text>

        {loading ? (
          <View
            style={[
              styles.statusCard,
              {
                borderColor: palette.icon + "22",
                backgroundColor: palette.card,
              },
            ]}
          >
            <ActivityIndicator color={palette.tint} size="large" />
            <Text style={[styles.statusText, { color: palette.icon }]}>
              Loading your current settings…
            </Text>
          </View>
        ) : error ? (
          <View
            style={[
              styles.statusCard,
              {
                borderColor: palette.icon + "22",
                backgroundColor: palette.card,
              },
            ]}
          >
            <MaterialIcons
              name="error-outline"
              size={20}
              color={palette.tint}
            />
            <Text style={[styles.statusText, { color: palette.icon }]}>
              Failed to load your existing preferences.
            </Text>
            {error?.message ? (
              <Text
                style={[styles.statusTextDetail, { color: palette.icon }]}
                numberOfLines={3}
              >
                {error.message}
              </Text>
            ) : null}
            <SecondaryButton
              label="Try again"
              palette={palette}
              onPress={onRetry}
            />
          </View>
        ) : (
          <View
            style={[
              styles.optionCard,
              {
                borderColor: palette.icon + "22",
                backgroundColor: palette.card,
              },
            ]}
          >
            {SAVE_OPTION_DEFINITIONS.map((option) => {
              const checked = state
                ? state[option.key]
                : DEFAULT_STATE[option.key];
              return (
                <Pressable
                  key={option.key}
                  style={styles.optionRow}
                  onPress={() => onToggle(option.key)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                >
                  <MaterialIcons
                    name={checked ? "check-box" : "check-box-outline-blank"}
                    size={24}
                    color={checked ? palette.tint : palette.icon}
                  />
                  <Text style={[styles.optionLabel, { color: palette.text }]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
      <View
        style={[
          styles.footerBar,
          {
            borderColor: palette.icon + "22",
            backgroundColor: palette.background,
          },
        ]}
      >
        {persistError ? (
          <Text style={[styles.errorText, { color: palette.tint }]}>
            {persistError}
          </Text>
        ) : null}
        {saving ? <ActivityIndicator color={palette.tint} /> : null}
        <PrimaryButton
          label="Continue to Review"
          onPress={onContinue}
          disabled={!canContinue || saving}
          palette={palette}
        />
      </View>
    </View>
  );
}

type SaveReviewScreenProps = {
  palette: AccountTabPalette;
  selections: SaveOptionState;
  onBack: () => void;
  onConfirm: () => void;
};

function SaveReviewScreen({
  palette,
  selections,
  onBack,
  onConfirm,
}: SaveReviewScreenProps) {
  const chosen = SAVE_OPTION_DEFINITIONS.filter(
    (option) => selections[option.key]
  );

  return (
    <View style={styles.stackScreen}>
      <StackHeader
        title="Review your choices"
        palette={palette}
        onBack={onBack}
      />
      <ScrollView contentContainerStyle={styles.reviewContent}>
        <Text style={[styles.reviewIntro, { color: palette.text }]}>
          Here’s what Cyd will archive on this device:
        </Text>
        <View style={[styles.reviewCard, { borderColor: palette.icon + "22" }]}>
          {chosen.map((option) => (
            <View key={option.key} style={styles.reviewRow}>
              <MaterialIcons
                name="check-circle"
                size={20}
                color={palette.tint}
              />
              <Text style={[styles.reviewLabel, { color: palette.text }]}>
                {option.reviewLabel}
              </Text>
            </View>
          ))}
        </View>
        <View
          style={[
            styles.infoCard,
            {
              borderColor: palette.icon + "22",
              backgroundColor: palette.card,
            },
          ]}
          accessibilityRole="text"
        >
          <Text style={[styles.infoText, { color: palette.text }]}>
            While Cyd is working, your phone must be unlocked and the Cyd app
            must stay active.
          </Text>
        </View>
      </ScrollView>
      <View
        style={[
          styles.footerBar,
          {
            borderColor: palette.icon + "22",
            backgroundColor: palette.background,
          },
        ]}
      >
        <SecondaryButton
          label="Back to Save Options"
          onPress={onBack}
          palette={palette}
        />
        <PrimaryButton
          label="Save My Data"
          onPress={onConfirm}
          disabled={chosen.length === 0}
          palette={palette}
        />
      </View>
    </View>
  );
}

type StackHeaderProps = {
  title: string;
  palette: AccountTabPalette;
  onBack: () => void;
};

function StackHeader({ title, palette, onBack }: StackHeaderProps) {
  return (
    <View
      style={[styles.header, { borderColor: palette.icon + "22" }]}
      accessibilityRole="header"
    >
      <Pressable
        onPress={onBack}
        style={styles.backButton}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <MaterialIcons name="arrow-back" size={24} color={palette.text} />
      </Pressable>
      <Text style={[styles.headerTitle, { color: palette.text }]}>{title}</Text>
    </View>
  );
}
type PrimaryButtonProps = {
  label: string;
  palette: AccountTabPalette;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
};

function PrimaryButton({
  label,
  palette,
  onPress,
  disabled,
}: PrimaryButtonProps) {
  const backgroundColor = palette.button?.background ?? palette.tint;
  const textColor = palette.button?.text ?? "#ffffff";
  return (
    <Pressable
      onPress={
        disabled
          ? undefined
          : () => {
              void onPress();
            }
      }
      style={({ pressed }) => [
        styles.primaryButton,
        {
          backgroundColor,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      <Text style={[styles.primaryButtonText, { color: textColor }]}>
        {label}
      </Text>
    </Pressable>
  );
}

type SecondaryButtonProps = {
  label: string;
  palette: AccountTabPalette;
  onPress: () => void | Promise<void>;
};

function SecondaryButton({ label, palette, onPress }: SecondaryButtonProps) {
  return (
    <Pressable
      onPress={() => {
        void onPress();
      }}
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
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 32,
    gap: 16,
  },
  headline: {
    fontSize: 22,
    fontWeight: "700",
  },
  subhead: {
    fontSize: 16,
    lineHeight: 22,
  },
  statusCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    alignItems: "center",
  },
  statusText: {
    fontSize: 15,
    textAlign: "center",
  },
  statusTextDetail: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    opacity: 0.85,
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
  },
  optionCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingVertical: 4,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  optionLabel: {
    fontSize: 16,
    flex: 1,
  },
  stackScreen: {
    flex: 1,
  },
  footerBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    paddingBottom: 24,
    paddingHorizontal: 16,
    alignItems: "center",
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 12,
    marginBottom: 16,
  },
  backButton: {
    padding: 4,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  reviewContent: {
    paddingBottom: 32,
    gap: 16,
  },
  reviewIntro: {
    fontSize: 16,
    lineHeight: 22,
  },
  infoCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    marginTop: 4,
    marginBottom: 4,
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
  },
  reviewCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  reviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  reviewLabel: {
    fontSize: 16,
    fontWeight: "600",
  },
  primaryButton: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: "center",
    alignSelf: "center",
    minWidth: 220,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 32,
    alignSelf: "center",
    minWidth: 220,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
});

export default SaveTab;

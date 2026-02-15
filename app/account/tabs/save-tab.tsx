import { MaterialIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { FinishedModal } from "@/app/account/components/FinishedModal";
import { SaveAutomationModal } from "@/app/account/components/SaveAutomationModal";
import {
  PrimaryButton,
  SecondaryButton,
  StackHeader,
} from "@/components/account/shared-tab-components";
import { sharedTabStyles } from "@/components/account/shared-tab-styles";
import { LastActionTimestamp } from "@/components/LastActionTimestamp";
import { useCydAccount } from "@/contexts";
import type {
  BlueskyJobRecord,
  SaveJobOptions,
} from "@/controllers/bluesky/job-types";
import { setLastSavedAt } from "@/database/accounts";
import type { AccountSaveSettings } from "@/database/save-settings";
import {
  getAccountSaveSettings,
  updateAccountSaveSettings,
} from "@/database/save-settings";
import { submitBlueskyProgress } from "@/services/submit-bluesky-progress";
import type { AccountTabPalette, AccountTabProps } from "@/types/account-tabs";

type SaveFlowScreen = "form" | "review";

const SAVE_OPTION_DEFINITIONS = [
  {
    key: "posts",
    label: "Save my posts and reposts",
    reviewLabel: "Save posts and reposts",
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
  const { apiClient } = useCydAccount();
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
  const [finishedModalVisible, setFinishedModalVisible] = useState(false);
  const [finishedJobs, setFinishedJobs] = useState<BlueskyJobRecord[]>([]);

  const selectedOptions = useMemo(() => {
    if (!state) {
      return [];
    }
    return SAVE_OPTION_DEFINITIONS.filter((option) => state[option.key]);
  }, [state]);

  const canContinue = Boolean(
    !loading && !error && state && selectedOptions.length > 0,
  );

  const goToBrowse = useCallback(() => {
    setFinishedModalVisible(false);
    setFinishedJobs([]);
    onSelectTab?.("browse");
  }, [onSelectTab]);
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
    [accountId],
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
    setFinishedModalVisible(false);
    setFinishedJobs([]);
    setAutomationOptions(state);
    setAutomationKey((prev) => prev + 1); // Force new modal instance
    setAutomationVisible(true);
  }, [accountId, state]);

  const closeFinishedModal = useCallback(() => {
    setFinishedModalVisible(false);
    setFinishedJobs([]);
  }, []);

  const goToDashboard = useCallback(() => {
    setFinishedModalVisible(false);
    setFinishedJobs([]);
    onSelectTab?.("dashboard");
  }, [onSelectTab]);

  const goToDelete = useCallback(() => {
    setFinishedModalVisible(false);
    setFinishedJobs([]);
    onSelectTab?.("delete");
  }, [onSelectTab]);

  return (
    <View style={styles.container}>
      {currentScreen === "form" && (
        <SaveOptionsForm
          accountId={accountId}
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
      <SaveAutomationModal
        key={automationKey}
        visible={automationVisible}
        accountId={accountId}
        accountUUID={accountUUID}
        palette={palette}
        options={mapStateToJobOptions(
          automationOptions ?? state ?? DEFAULT_STATE,
        )}
        onFinished={(_result, jobs) => {
          // Submit progress to the server regardless of success/failure
          void submitBlueskyProgress(apiClient, accountId, accountUUID);

          const hadSaveJobs = jobs.some(
            (j) => j.jobType.startsWith("save") && j.status === "completed",
          );
          if (hadSaveJobs) {
            void setLastSavedAt(accountId, Date.now());
          }

          setAutomationVisible(false);
          setFinishedJobs(jobs);
          setFinishedModalVisible(true);
        }}
        onClose={(jobs) => {
          // Submit progress to the server regardless of success/failure
          void submitBlueskyProgress(apiClient, accountId, accountUUID);

          const hadSaveJobs = jobs.some(
            (j) => j.jobType.startsWith("save") && j.status === "completed",
          );
          if (hadSaveJobs) {
            void setLastSavedAt(accountId, Date.now());
          }

          setAutomationVisible(false);
          setFinishedJobs(jobs);
          setFinishedModalVisible(true);
        }}
        onRestart={(jobs) => {
          void submitBlueskyProgress(apiClient, accountId, accountUUID);

          const hasCompletedWork = jobs.some(
            (j) =>
              j.jobType !== "verifyAuthorization" && j.status === "completed",
          );
          if (hasCompletedWork) {
            const hadSaveJobs = jobs.some(
              (j) => j.jobType.startsWith("save") && j.status === "completed",
            );
            if (hadSaveJobs) {
              void setLastSavedAt(accountId, Date.now());
            }
            setAutomationVisible(false);
            setFinishedJobs(jobs);
            setFinishedModalVisible(true);
          } else {
            setAutomationVisible(false);
            resetToForm();
          }
        }}
      />
      <FinishedModal
        visible={finishedModalVisible}
        palette={palette}
        jobs={finishedJobs}
        onClose={closeFinishedModal}
        onViewDashboard={goToDashboard}
        onViewBrowse={goToBrowse}
        onViewDelete={goToDelete}
      />
    </View>
  );
}

type SaveOptionsFormProps = {
  accountId: number;
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
  accountId,
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

        <LastActionTimestamp
          accountId={accountId}
          palette={palette}
          actionType="save"
        />
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
    (option) => selections[option.key],
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
          Here’s what Cyd will save on this device:
        </Text>
        <View style={[styles.reviewCard, { borderColor: palette.icon + "22" }]}>
          {chosen.map((option) => (
            <View key={option.key} style={sharedTabStyles.reviewRow}>
              <MaterialIcons
                name="check-circle"
                size={20}
                color={palette.tint}
                style={sharedTabStyles.reviewIcon}
              />
              <Text
                style={[sharedTabStyles.reviewLabel, { color: palette.text }]}
              >
                {option.reviewLabel}
              </Text>
            </View>
          ))}
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

// Use shared styles for consistency across tabs
const styles = sharedTabStyles;

export default SaveTab;

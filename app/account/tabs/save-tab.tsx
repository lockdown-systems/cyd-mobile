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
  CheckboxRow,
  PrimaryButton,
  SecondaryButton,
  StackHeader,
} from "@/components/account/shared-tab-components";
import { sharedTabStyles } from "@/components/account/shared-tab-styles";
import { LastActionTimestamp } from "@/components/LastActionTimestamp";
import { useCydAccount } from "@/contexts";
import { withBlueskyController } from "@/controllers";
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

// Optional follow suggestions shown at the bottom of the save form. DIDs are
// hardcoded (rather than resolved from handles) so the app can never follow
// the wrong account if a handle changes hands; handles are display-only.
const FOLLOW_SUGGESTIONS = [
  {
    did: "did:plc:4s3vbdjzno5a3dmawzblaj4z",
    handle: "cyd.social",
    label: "Follow @cyd.social",
    hint: "Updates about Cyd",
  },
  {
    did: "did:plc:izxbs36as3lcjc2x7hamltnq",
    handle: "lockdown.systems",
    label: "Follow @lockdown.systems",
    hint: "News from the collective that makes Cyd",
  },
] as const;

type FollowSuggestion = (typeof FOLLOW_SUGGESTIONS)[number];

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
  // DIDs the user is confirmed NOT to follow yet. Suggestions stay hidden
  // until confirmed (fail closed), so we never pitch a follow to someone who
  // already follows — or show anything while the check is loading or failed.
  const [unfollowedDids, setUnfollowedDids] = useState<Set<string>>(new Set());
  // In-memory only, deliberately not persisted: these are one-shot actions,
  // not settings, and a stale checked intent must never fire on a later visit.
  const [followChecks, setFollowChecks] = useState<Record<string, boolean>>({});

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

    void (async () => {
      // Yield one microtask so the setState calls below aren't synchronous
      // within the effect body.
      await Promise.resolve();
      if (cancelled) return;

      setScreenStack(["form"]);
      setState(null);
      setError(null);
      setPersistError(null);
      setSaving(false);
      setLoading(true);
      setAutomationVisible(false);
      setAutomationOptions(null);

      console.log("[SaveTab] load settings -> start", accountId);

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

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Yield one microtask so the setState calls below aren't synchronous
      // within the effect body.
      await Promise.resolve();
      if (cancelled) return;

      setUnfollowedDids(new Set());
      setFollowChecks({});

      const ownHandle = handle.replace(/^@/, "").toLowerCase();
      const suggestions = FOLLOW_SUGGESTIONS.filter(
        (suggestion) => suggestion.handle !== ownHandle,
      );
      if (suggestions.length === 0) {
        return;
      }

      try {
        const dids = await withBlueskyController(
          accountId,
          accountUUID,
          async (controller) => {
            if (!controller.isAgentReady()) {
              await controller.initAgent();
            }
            const results = await Promise.all(
              suggestions.map(async (suggestion): Promise<string | null> => {
                const profile = await controller.getProfile(suggestion.did);
                return profile && !profile.viewer?.following
                  ? suggestion.did
                  : null;
              }),
            );
            return results.filter((did): did is string => did !== null);
          },
        );
        if (!cancelled) {
          setUnfollowedDids(new Set(dids));
        }
      } catch (err) {
        // Fail closed: the optional follow suggestions just don't appear.
        console.log("[SaveTab] follow status check failed", accountId, err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, accountUUID, handle]);

  const followSuggestions = useMemo(
    () =>
      FOLLOW_SUGGESTIONS.filter((suggestion) =>
        unfollowedDids.has(suggestion.did),
      ),
    [unfollowedDids],
  );

  const checkedFollowSuggestions = useMemo(
    () =>
      followSuggestions.filter((suggestion) => followChecks[suggestion.did]),
    [followSuggestions, followChecks],
  );

  const handleToggleFollow = useCallback((did: string) => {
    setFollowChecks((prev) => ({ ...prev, [did]: !prev[did] }));
  }, []);

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

  const followCheckedAccounts = useCallback(() => {
    const targets = checkedFollowSuggestions;
    if (targets.length === 0) {
      return;
    }
    // Fire-and-forget: silent on success and failure. A failed follow just
    // means the checkbox reappears on the next visit.
    void withBlueskyController(accountId, accountUUID, async (controller) => {
      if (!controller.isAgentReady()) {
        await controller.initAgent();
      }
      for (const target of targets) {
        try {
          await controller.followUser(target.did);
          setUnfollowedDids((prev) => {
            const next = new Set(prev);
            next.delete(target.did);
            return next;
          });
        } catch (err) {
          console.warn("[SaveTab] optional follow failed", target.handle, err);
        }
      }
    }).catch((err) => {
      console.warn("[SaveTab] optional follows failed", accountId, err);
    });
  }, [accountId, accountUUID, checkedFollowSuggestions]);

  const handleConfirm = useCallback(() => {
    if (!state) return;
    console.log("[SaveTab] confirm automation", accountId);
    followCheckedAccounts();
    setFinishedModalVisible(false);
    setFinishedJobs([]);
    setAutomationOptions(state);
    setAutomationKey((prev) => prev + 1); // Force new modal instance
    setAutomationVisible(true);
  }, [accountId, state, followCheckedAccounts]);

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
          followSuggestions={followSuggestions}
          followChecks={followChecks}
          onToggleFollow={handleToggleFollow}
        />
      )}
      {currentScreen === "review" && state && (
        <SaveReviewScreen
          palette={palette}
          selections={state}
          followSelections={checkedFollowSuggestions}
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
  followSuggestions: readonly FollowSuggestion[];
  followChecks: Record<string, boolean>;
  onToggleFollow: (did: string) => void;
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
  followSuggestions,
  followChecks,
  onToggleFollow,
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

        {!loading && !error && followSuggestions.length > 0 ? (
          <>
            <Text style={[styles.optionHint, { color: palette.icon }]}>
              Optional
            </Text>
            <View
              style={[
                styles.optionCard,
                {
                  borderColor: palette.icon + "22",
                  backgroundColor: palette.card,
                },
              ]}
            >
              {followSuggestions.map((suggestion) => (
                <CheckboxRow
                  key={suggestion.did}
                  label={suggestion.label}
                  hint={suggestion.hint}
                  checked={Boolean(followChecks[suggestion.did])}
                  onToggle={() => onToggleFollow(suggestion.did)}
                  palette={palette}
                />
              ))}
            </View>
          </>
        ) : null}
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
  followSelections: readonly FollowSuggestion[];
  onBack: () => void;
  onConfirm: () => void;
};

function SaveReviewScreen({
  palette,
  selections,
  followSelections,
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

        {followSelections.length > 0 ? (
          <>
            <Text style={[styles.optionHint, { color: palette.icon }]}>
              Optional
            </Text>
            <View
              style={[styles.reviewCard, { borderColor: palette.icon + "22" }]}
            >
              {followSelections.map((suggestion) => (
                <View key={suggestion.did} style={sharedTabStyles.reviewRow}>
                  <MaterialIcons
                    name="person-add"
                    size={20}
                    color={palette.icon}
                    style={sharedTabStyles.reviewIcon}
                  />
                  <Text
                    style={[
                      sharedTabStyles.reviewLabel,
                      { color: palette.icon },
                    ]}
                  >
                    {suggestion.label}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
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

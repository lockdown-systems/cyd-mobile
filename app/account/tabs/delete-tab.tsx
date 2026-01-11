import { MaterialIcons } from "@expo/vector-icons";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { DeleteAutomationModal } from "@/app/account/components/DeleteAutomationModal";
import { FinishedModal } from "@/app/account/components/FinishedModal";
import { PostsToDeleteReviewModal } from "@/components/PostsToDeleteReviewModal";
import { PremiumRequiredBanner } from "@/components/PremiumRequiredBanner";
import { PremiumRequiredModal } from "@/components/PremiumRequiredModal";
import { SaveStatusBanner } from "@/components/SaveStatusBanner";
import { useCydAccount } from "@/contexts/CydAccountProvider";
import { BlueskyAccountController } from "@/controllers";
import type { DeletionPreviewCounts } from "@/controllers/bluesky/deletion-calculator";
import type { BlueskyJobRecord } from "@/controllers/bluesky/job-types";
import { getLastSavedAt } from "@/database/accounts";
import {
  getAccountDeleteSettings,
  updateAccountDeleteSettings,
  type AccountDeleteSettings,
} from "@/database/delete-settings";
import { submitBlueskyProgress } from "@/services/submit-bluesky-progress";
import type {
  AccountTabKey,
  AccountTabPalette,
  AccountTabProps,
} from "@/types/account-tabs";
import { sharedTabStyles } from "./shared-tab-styles";

type DeleteFlowScreen = "form" | "review";

export function DeleteTab({
  accountId,
  accountUUID,
  handle,
  palette,
  onSelectTab,
}: AccountTabProps) {
  const { apiClient } = useCydAccount();
  const [screenStack, setScreenStack] = useState<DeleteFlowScreen[]>(["form"]);
  const [state, setState] = useState<AccountDeleteSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Automation modal state
  const [automationVisible, setAutomationVisible] = useState(false);
  const [automationSettings, setAutomationSettings] =
    useState<AccountDeleteSettings | null>(null);
  const [automationCounts, setAutomationCounts] = useState<{
    posts: number;
    reposts: number;
    likes: number;
    bookmarks: number;
    messages: number;
    follows: number;
  } | null>(null);
  const [automationKey, setAutomationKey] = useState(0);
  const automationCancelledRef = useRef(false);

  // Finished modal state
  const [finishedModalVisible, setFinishedModalVisible] = useState(false);
  const [finishedJobs, setFinishedJobs] = useState<BlueskyJobRecord[]>([]);

  const currentScreen = screenStack[screenStack.length - 1];

  // Refresh lastSavedAt data whenever component mounts
  useEffect(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPersistError(null);
    setSaving(false);
    try {
      const settings = await getAccountDeleteSettings(accountId);
      setState(settings);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setState(null);
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

    void (async () => {
      try {
        const settings = await getAccountDeleteSettings(accountId);
        if (!cancelled) {
          setState(settings);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setState(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const pushScreen = useCallback((next: DeleteFlowScreen) => {
    setScreenStack((prev) => [...prev, next]);
  }, []);

  const popScreen = useCallback(() => {
    setScreenStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const updateSetting = useCallback(
    <K extends keyof AccountDeleteSettings>(
      key: K,
      value: AccountDeleteSettings[K]
    ) => {
      setPersistError(null);
      setState((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    []
  );

  const canContinue = useMemo(() => {
    if (!state) return false;
    return (
      state.deletePosts ||
      state.deleteReposts ||
      state.deleteLikes ||
      state.deleteBookmarks ||
      state.deleteChats ||
      state.deleteUnfollowEveryone
    );
  }, [state]);

  const handleContinue = useCallback(async () => {
    if (!state || !canContinue) return;
    setSaving(true);
    setPersistError(null);
    try {
      await updateAccountDeleteSettings(accountId, state);
      pushScreen("review");
    } catch {
      setPersistError("Failed to save your selections. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [accountId, canContinue, state, pushScreen]);

  const resetToForm = useCallback(() => {
    setScreenStack(["form"]);
    setPersistError(null);
    setSaving(false);
    setAutomationVisible(false);
    setAutomationSettings(null);
    setAutomationCounts(null);
  }, []);

  // Premium modal state
  const [premiumModalVisible, setPremiumModalVisible] = useState(false);
  const [pendingDeleteSettings, setPendingDeleteSettings] =
    useState<AccountDeleteSettings | null>(null);
  const [pendingDeleteCounts, setPendingDeleteCounts] =
    useState<DeletionPreviewCounts | null>(null);

  const handlePremiumRequired = useCallback(
    (settings: AccountDeleteSettings, counts: DeletionPreviewCounts) => {
      setPendingDeleteSettings(settings);
      setPendingDeleteCounts(counts);
      setPremiumModalVisible(true);
    },
    []
  );

  const handlePremiumDismiss = useCallback(() => {
    setPremiumModalVisible(false);
    setPendingDeleteSettings(null);
    setPendingDeleteCounts(null);
    // Reset to the form screen
    resetToForm();
  }, [resetToForm]);

  const handlePremiumConfirmed = useCallback(() => {
    setPremiumModalVisible(false);
    // Start deletion with the pending settings and counts
    if (pendingDeleteSettings && pendingDeleteCounts) {
      automationCancelledRef.current = false;
      setAutomationSettings(pendingDeleteSettings);
      setAutomationCounts({
        posts: pendingDeleteCounts.posts,
        reposts: pendingDeleteCounts.reposts,
        likes: pendingDeleteCounts.likes,
        bookmarks: pendingDeleteCounts.bookmarks,
        messages: pendingDeleteCounts.messages,
        follows: pendingDeleteCounts.follows,
      });
      setAutomationKey((prev) => prev + 1);
      setAutomationVisible(true);
    }
    setPendingDeleteSettings(null);
    setPendingDeleteCounts(null);
  }, [pendingDeleteSettings, pendingDeleteCounts]);

  const handleStartDelete = useCallback(
    (settings: AccountDeleteSettings, counts: DeletionPreviewCounts) => {
      automationCancelledRef.current = false;
      setAutomationSettings(settings);
      setAutomationCounts({
        posts: counts.posts,
        reposts: counts.reposts,
        likes: counts.likes,
        bookmarks: counts.bookmarks,
        messages: counts.messages,
        follows: counts.follows,
      });
      setAutomationKey((prev) => prev + 1);
      setAutomationVisible(true);
    },
    []
  );

  const handleAutomationFinished = useCallback(
    (result: "completed" | "failed", jobs: BlueskyJobRecord[]) => {
      // Submit progress to the server regardless of success/failure
      void submitBlueskyProgress(apiClient, accountId, accountUUID);

      if (!automationCancelledRef.current) {
        setAutomationVisible(false);
        // Delay showing the FinishedModal to allow the DeleteAutomationModal to fully dismiss
        setTimeout(() => {
          setFinishedJobs(jobs);
          setFinishedModalVisible(true);
        }, 350);
        // Refresh the review screen counts
        setRefreshKey((prev) => prev + 1);
      }
    },
    [apiClient, accountId, accountUUID]
  );

  const closeFinishedModal = useCallback(() => {
    setFinishedModalVisible(false);
    setFinishedJobs([]);
    resetToForm();
  }, [resetToForm]);

  const handleFinishedBrowse = useCallback(() => {
    setFinishedModalVisible(false);
    setFinishedJobs([]);
    onSelectTab?.("browse");
  }, [onSelectTab]);

  const handleAutomationClose = useCallback(() => {
    automationCancelledRef.current = true;
    setAutomationVisible(false);
  }, []);

  const handleAutomationRestart = useCallback(() => {
    automationCancelledRef.current = true;
    setAutomationVisible(false);
    resetToForm();
  }, [resetToForm]);

  return (
    <View style={styles.container}>
      {currentScreen === "form" && (
        <DeleteOptionsForm
          accountId={accountId}
          handle={handle}
          palette={palette}
          state={state}
          loading={loading}
          error={error}
          onRetry={loadSettings}
          onUpdate={updateSetting}
          onContinue={handleContinue}
          canContinue={canContinue}
          saving={saving}
          persistError={persistError}
          onSelectTab={onSelectTab}
          refreshKey={refreshKey}
        />
      )}
      {currentScreen === "review" && state && (
        <DeleteReviewScreen
          accountId={accountId}
          accountUUID={accountUUID}
          palette={palette}
          selections={state}
          onBack={popScreen}
          onConfirm={handleStartDelete}
          onPremiumRequired={handlePremiumRequired}
          refreshKey={refreshKey}
        />
      )}
      {automationSettings && automationCounts && (
        <DeleteAutomationModal
          key={automationKey}
          visible={automationVisible}
          accountId={accountId}
          accountUUID={accountUUID}
          palette={palette}
          settings={automationSettings}
          counts={automationCounts}
          onFinished={handleAutomationFinished}
          onClose={handleAutomationClose}
          onRestart={handleAutomationRestart}
        />
      )}
      <PremiumRequiredModal
        visible={premiumModalVisible}
        palette={palette}
        onDismiss={handlePremiumDismiss}
        onPremiumConfirmed={handlePremiumConfirmed}
      />
      <FinishedModal
        visible={finishedModalVisible}
        palette={palette}
        jobs={finishedJobs}
        mode="delete"
        onClose={closeFinishedModal}
        onViewBrowse={handleFinishedBrowse}
      />
    </View>
  );
}

type DeleteOptionsFormProps = {
  accountId: number;
  handle: string;
  palette: AccountTabPalette;
  state: AccountDeleteSettings | null;
  loading: boolean;
  error: Error | null;
  onRetry: () => void | Promise<void>;
  onUpdate: <K extends keyof AccountDeleteSettings>(
    key: K,
    value: AccountDeleteSettings[K]
  ) => void;
  onContinue: () => void | Promise<void>;
  canContinue: boolean;
  saving: boolean;
  persistError: string | null;
  onSelectTab?: (tab: AccountTabKey) => void;
  refreshKey: number;
};

function DeleteOptionsForm({
  accountId,
  handle,
  palette,
  state,
  loading,
  error,
  onRetry,
  onUpdate,
  onContinue,
  canContinue,
  saving,
  persistError,
  onSelectTab,
  refreshKey,
}: DeleteOptionsFormProps) {
  const [lastSavedAt, setLastSavedAt] = useState<number | null | undefined>(
    undefined
  );

  useEffect(() => {
    void (async () => {
      const ts = await getLastSavedAt(accountId);
      setLastSavedAt(ts);
    })();
  }, [accountId, refreshKey]);

  const hasSavedData = lastSavedAt !== null && lastSavedAt !== undefined;

  return (
    <View style={styles.stackScreen}>
      <PremiumRequiredBanner palette={palette} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.headline, { color: palette.text }]}>
          Choose what to delete
        </Text>
        <Text style={[styles.subhead, { color: palette.icon }]}>
          What data would you like Cyd to delete for you?
        </Text>

        <SaveStatusBanner
          accountId={accountId}
          palette={palette}
          onSelectTab={onSelectTab}
          refreshKey={refreshKey}
        />

        {hasSavedData && (
          <>
            {loading ? (
              <StatusCard palette={palette}>
                <ActivityIndicator color={palette.tint} size="large" />
                <Text style={[styles.statusText, { color: palette.icon }]}>
                  Loading your current settings…
                </Text>
              </StatusCard>
            ) : error ? (
              <StatusCard palette={palette}>
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
              </StatusCard>
            ) : state ? (
              <View
                style={[
                  styles.optionCard,
                  {
                    borderColor: palette.icon + "22",
                    backgroundColor: palette.card,
                  },
                ]}
              >
                <CheckboxRow
                  palette={palette}
                  label="Delete my posts"
                  checked={state.deletePosts}
                  onToggle={(next) => onUpdate("deletePosts", next)}
                />
                <Indented>
                  <CheckboxRow
                    palette={palette}
                    label="older than"
                    checked={state.deletePostsDaysOldEnabled}
                    disabled={!state.deletePosts}
                    onToggle={(next) =>
                      onUpdate("deletePostsDaysOldEnabled", next)
                    }
                  >
                    <View style={styles.inlineNumberRow}>
                      <NumberInput
                        palette={palette}
                        value={state.deletePostsDaysOld}
                        onChange={(value) =>
                          onUpdate("deletePostsDaysOld", value)
                        }
                        disabled={
                          !state.deletePosts || !state.deletePostsDaysOldEnabled
                        }
                        min={0}
                        suffix="days"
                      />
                    </View>
                  </CheckboxRow>
                  <CheckboxRow
                    palette={palette}
                    label="unless they have at least"
                    checked={state.deletePostsLikesThresholdEnabled}
                    disabled={!state.deletePosts}
                    onToggle={(next) =>
                      onUpdate("deletePostsLikesThresholdEnabled", next)
                    }
                  >
                    <View style={styles.inlineNumberRow}>
                      <NumberInput
                        palette={palette}
                        value={state.deletePostsLikesThreshold}
                        onChange={(value) =>
                          onUpdate("deletePostsLikesThreshold", value)
                        }
                        disabled={
                          !state.deletePosts ||
                          !state.deletePostsLikesThresholdEnabled
                        }
                        min={0}
                        suffix="likes"
                      />
                    </View>
                  </CheckboxRow>
                  <CheckboxRow
                    palette={palette}
                    label="or at least"
                    checked={state.deletePostsRepostsThresholdEnabled}
                    disabled={!state.deletePosts}
                    onToggle={(next) =>
                      onUpdate("deletePostsRepostsThresholdEnabled", next)
                    }
                  >
                    <View style={styles.inlineNumberRow}>
                      <NumberInput
                        palette={palette}
                        value={state.deletePostsRepostsThreshold}
                        onChange={(value) =>
                          onUpdate("deletePostsRepostsThreshold", value)
                        }
                        disabled={
                          !state.deletePosts ||
                          !state.deletePostsRepostsThresholdEnabled
                        }
                        min={0}
                        suffix="reposts"
                      />
                    </View>
                  </CheckboxRow>

                  <CheckboxRow
                    palette={palette}
                    label="Preserve entire threads if any post meets these thresholds"
                    checked={state.deletePostsPreserveThreads}
                    disabled={
                      !state.deletePosts ||
                      (!state.deletePostsLikesThresholdEnabled &&
                        !state.deletePostsRepostsThresholdEnabled)
                    }
                    onToggle={(next) =>
                      onUpdate("deletePostsPreserveThreads", next)
                    }
                  />
                </Indented>

                <CheckboxRow
                  palette={palette}
                  label="Delete my reposts"
                  checked={state.deleteReposts}
                  onToggle={(next) => onUpdate("deleteReposts", next)}
                />
                <Indented>
                  <CheckboxRow
                    palette={palette}
                    label="older than"
                    checked={state.deleteRepostsDaysOldEnabled}
                    disabled={!state.deleteReposts}
                    onToggle={(next) =>
                      onUpdate("deleteRepostsDaysOldEnabled", next)
                    }
                  >
                    <View style={styles.inlineNumberRow}>
                      <NumberInput
                        palette={palette}
                        value={state.deleteRepostsDaysOld}
                        onChange={(value) =>
                          onUpdate("deleteRepostsDaysOld", value)
                        }
                        disabled={
                          !state.deleteReposts ||
                          !state.deleteRepostsDaysOldEnabled
                        }
                        min={0}
                        suffix="days"
                      />
                    </View>
                  </CheckboxRow>
                </Indented>

                <CheckboxRow
                  palette={palette}
                  label="Delete my likes"
                  checked={state.deleteLikes}
                  onToggle={(next) => onUpdate("deleteLikes", next)}
                />
                <Indented>
                  <CheckboxRow
                    palette={palette}
                    label="older than"
                    checked={state.deleteLikesDaysOldEnabled}
                    disabled={!state.deleteLikes}
                    onToggle={(next) =>
                      onUpdate("deleteLikesDaysOldEnabled", next)
                    }
                  >
                    <View style={styles.inlineNumberRow}>
                      <NumberInput
                        palette={palette}
                        value={state.deleteLikesDaysOld}
                        onChange={(value) =>
                          onUpdate("deleteLikesDaysOld", value)
                        }
                        disabled={
                          !state.deleteLikes || !state.deleteLikesDaysOldEnabled
                        }
                        min={0}
                        suffix="days"
                      />
                    </View>
                  </CheckboxRow>
                </Indented>

                <CheckboxRow
                  palette={palette}
                  label="Delete my chat messages"
                  checked={state.deleteChats}
                  onToggle={(next) => onUpdate("deleteChats", next)}
                />
                <Indented>
                  <CheckboxRow
                    palette={palette}
                    label="older than"
                    checked={state.deleteChatsDaysOldEnabled}
                    disabled={!state.deleteChats}
                    onToggle={(next) =>
                      onUpdate("deleteChatsDaysOldEnabled", next)
                    }
                  >
                    <View style={styles.inlineNumberRow}>
                      <NumberInput
                        palette={palette}
                        value={state.deleteChatsDaysOld}
                        onChange={(value) =>
                          onUpdate("deleteChatsDaysOld", value)
                        }
                        disabled={
                          !state.deleteChats || !state.deleteChatsDaysOldEnabled
                        }
                        min={0}
                        suffix="days"
                      />
                    </View>
                  </CheckboxRow>
                </Indented>

                <CheckboxRow
                  palette={palette}
                  label="Delete my bookmarks"
                  checked={state.deleteBookmarks}
                  onToggle={(next) => onUpdate("deleteBookmarks", next)}
                />

                <CheckboxRow
                  palette={palette}
                  label="Unfollow everyone"
                  checked={state.deleteUnfollowEveryone}
                  onToggle={(next) => onUpdate("deleteUnfollowEveryone", next)}
                />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {hasSavedData && (
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
      )}
    </View>
  );
}

type DeleteReviewScreenProps = {
  accountId: number;
  accountUUID: string;
  palette: AccountTabPalette;
  selections: AccountDeleteSettings;
  onBack: () => void;
  onConfirm: (
    settings: AccountDeleteSettings,
    counts: DeletionPreviewCounts
  ) => void;
  onPremiumRequired: (
    settings: AccountDeleteSettings,
    counts: DeletionPreviewCounts
  ) => void;
  refreshKey: number;
};

function DeleteReviewScreen({
  accountId,
  accountUUID,
  palette,
  selections,
  onBack,
  onConfirm,
  onPremiumRequired,
  refreshKey: externalRefreshKey,
}: DeleteReviewScreenProps) {
  const { state: cydState, apiClient } = useCydAccount();
  const [counts, setCounts] = useState<DeletionPreviewCounts | null>(null);
  const [countsLoading, setCountsLoading] = useState(true);
  const [countsError, setCountsError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [checkingPremium, setCheckingPremium] = useState(false);

  // Refresh when external key changes (e.g., after automation completes)
  useEffect(() => {
    setRefreshKey((prev) => prev + 1);
  }, [externalRefreshKey]);

  // Modal state for reviewing posts to delete
  const [postsModalVisible, setPostsModalVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadCounts() {
      setCountsLoading(true);
      setCountsError(null);
      try {
        const controller = new BlueskyAccountController(accountId, accountUUID);
        await controller.initDB();
        await controller.initAgent();
        const result = controller.getDeletionPreviewCounts(selections);
        if (!cancelled) {
          setCounts(result);
        }
      } catch (err) {
        if (!cancelled) {
          setCountsError(
            err instanceof Error ? err.message : "Failed to calculate counts"
          );
        }
      } finally {
        if (!cancelled) {
          setCountsLoading(false);
        }
      }
    }

    void loadCounts();

    return () => {
      cancelled = true;
    };
  }, [accountId, accountUUID, selections, refreshKey]);

  // Handle modal open
  const handleOpenPostsModal = useCallback(() => {
    setPostsModalVisible(true);
  }, []);

  // Handle modal close - recalculate counts
  const handleClosePostsModal = useCallback(() => {
    setPostsModalVisible(false);
    // Trigger a refresh of the counts
    setRefreshKey((prev) => prev + 1);
  }, []);

  // Handle Delete My Data button - check premium first
  const handleDeletePress = useCallback(async () => {
    if (!counts) return;

    // If not signed in, show premium modal
    if (!cydState.isSignedIn) {
      onPremiumRequired(selections, counts);
      return;
    }

    // Check if user has premium
    setCheckingPremium(true);
    try {
      const response = await apiClient.getUserPremium();
      if ("error" in response || !response.premium_access) {
        // No premium, show the modal
        onPremiumRequired(selections, counts);
      } else {
        // Has premium, proceed with deletion
        onConfirm(selections, counts);
      }
    } catch {
      // Error checking premium, show the modal to be safe
      onPremiumRequired(selections, counts);
    } finally {
      setCheckingPremium(false);
    }
  }, [
    counts,
    cydState.isSignedIn,
    apiClient,
    selections,
    onConfirm,
    onPremiumRequired,
  ]);

  type DeletionItem = {
    label: string;
    count: number | null;
    isChatMessage?: boolean;
    showReviewButton?: boolean;
    onReview?: () => void;
  };

  const chosen: DeletionItem[] = [];

  if (selections.deletePosts) {
    const hasAgeFilter = selections.deletePostsDaysOldEnabled;
    const conditions: string[] = [];
    if (selections.deletePostsLikesThresholdEnabled) {
      conditions.push(`${selections.deletePostsLikesThreshold} likes`);
    }
    if (selections.deletePostsRepostsThresholdEnabled) {
      conditions.push(`${selections.deletePostsRepostsThreshold} reposts`);
    }

    let message =
      hasAgeFilter || conditions.length > 0
        ? "Delete posts"
        : "Delete all posts";

    if (hasAgeFilter) {
      message += ` older than ${selections.deletePostsDaysOld} days`;
    }

    if (conditions.length > 0) {
      message += ` unless they have at least ${conditions.join(" or ")}`;
    }

    if (selections.deletePostsPreserveThreads && conditions.length > 0) {
      message += ", preserving entire threads";
    }

    chosen.push({
      label: message,
      count: counts?.posts ?? null,
      showReviewButton: true,
      onReview: handleOpenPostsModal,
    });
  }

  if (selections.deleteReposts) {
    let message = selections.deleteRepostsDaysOldEnabled
      ? "Delete reposts"
      : "Delete all reposts";
    if (selections.deleteRepostsDaysOldEnabled) {
      message += ` older than ${selections.deleteRepostsDaysOld} days`;
    }
    chosen.push({ label: message, count: counts?.reposts ?? null });
  }

  if (selections.deleteLikes) {
    let message = selections.deleteLikesDaysOldEnabled
      ? "Delete likes"
      : "Delete all likes";
    if (selections.deleteLikesDaysOldEnabled) {
      message += ` older than ${selections.deleteLikesDaysOld} days`;
    }
    chosen.push({ label: message, count: counts?.likes ?? null });
  }

  if (selections.deleteBookmarks) {
    chosen.push({
      label: "Delete all bookmarks",
      count: counts?.bookmarks ?? null,
    });
  }

  if (selections.deleteChats) {
    let message = selections.deleteChatsDaysOldEnabled
      ? "Delete chat messages"
      : "Delete all chat messages";
    if (selections.deleteChatsDaysOldEnabled) {
      message += ` older than ${selections.deleteChatsDaysOld} days`;
    }
    chosen.push({
      label: message,
      count: counts?.messages ?? null,
      isChatMessage: true,
    });
  }

  if (selections.deleteUnfollowEveryone) {
    // Note: We don't show item count for "Unfollow everyone" because we don't save
    // the following list locally. The count will be determined from the API at runtime.
    chosen.push({
      label: "Unfollow everyone",
      count: null,
    });
  }

  return (
    <View style={styles.stackScreen}>
      <StackHeader
        title="Review your choices"
        palette={palette}
        onBack={onBack}
      />
      <ScrollView contentContainerStyle={styles.reviewContent}>
        <Text style={[styles.reviewIntro, { color: palette.text }]}>
          Here’s what Cyd will delete on this device:
        </Text>
        <View style={[styles.reviewCard, { borderColor: palette.icon + "22" }]}>
          {countsLoading ? (
            <View style={styles.countsLoadingContainer}>
              <ActivityIndicator size="small" color={palette.tint} />
              <Text style={[styles.countsLoadingText, { color: palette.icon }]}>
                Calculating items to delete...
              </Text>
            </View>
          ) : countsError ? (
            <Text style={[styles.reviewLabel, { color: palette.icon }]}>
              {countsError}
            </Text>
          ) : chosen.length === 0 ? (
            <Text style={[styles.reviewLabel, { color: palette.icon }]}>
              No data selected for deletion.
            </Text>
          ) : (
            chosen.map((item) => {
              return (
                <View key={item.label}>
                  <View style={sharedTabStyles.reviewRow}>
                    <MaterialIcons
                      name="check-circle"
                      size={20}
                      color={palette.tint}
                      style={sharedTabStyles.reviewIcon}
                    />
                    <View style={styles.reviewLabelContainer}>
                      <Text
                        style={[
                          sharedTabStyles.reviewLabel,
                          { color: palette.text },
                        ]}
                      >
                        {item.label}
                      </Text>
                      {item.count !== null && (
                        <Text
                          style={[styles.reviewCount, { color: palette.tint }]}
                        >
                          {item.count.toLocaleString()}{" "}
                          {item.count === 1 ? "item" : "items"}
                        </Text>
                      )}
                    </View>
                  </View>
                  {item.showReviewButton && item.onReview && (
                    <Pressable
                      onPress={item.onReview}
                      style={[
                        styles.reviewPostsButton,
                        { borderColor: palette.tint },
                      ]}
                    >
                      <Text
                        style={[
                          styles.reviewPostsButtonText,
                          { color: palette.tint },
                        ]}
                      >
                        Review Posts
                      </Text>
                    </Pressable>
                  )}
                  {item.isChatMessage && (
                    <Text
                      style={[
                        styles.reviewSubtext,
                        { color: palette.icon, marginLeft: 28, marginTop: 4 },
                      ]}
                    >
                      Cyd will your copies of chat messages. People you chat
                      with will still have their copies.
                    </Text>
                  )}
                </View>
              );
            })
          )}
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
            If you have a lot of data, deleting your data might take a long
            time. While Cyd is working, your phone must be unlocked and the Cyd
            app must stay active the whole time.
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
          label="Back to Delete Options"
          onPress={onBack}
          palette={palette}
        />
        <PrimaryButton
          label={checkingPremium ? "Checking..." : "Delete My Data"}
          onPress={handleDeletePress}
          disabled={chosen.length === 0 || !counts || checkingPremium}
          palette={palette}
        />
      </View>

      {/* Posts to delete review modal */}
      <PostsToDeleteReviewModal
        visible={postsModalVisible}
        onClose={handleClosePostsModal}
        accountId={accountId}
        accountUUID={accountUUID}
        palette={palette}
        selections={selections}
      />
    </View>
  );
}

function StackHeader({
  title,
  palette,
  onBack,
}: {
  title: string;
  palette: AccountTabPalette;
  onBack: () => void;
}) {
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

function StatusCard({
  children,
  palette,
}: {
  children: ReactNode;
  palette: AccountTabPalette;
}) {
  return (
    <View
      style={[
        styles.statusCard,
        {
          borderColor: palette.icon + "22",
          backgroundColor: palette.card,
        },
      ]}
    >
      {children}
    </View>
  );
}

function CheckboxRow({
  label,
  checked,
  onToggle,
  palette,
  disabled,
  trailing,
  children,
}: {
  label: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
  palette: AccountTabPalette;
  disabled?: boolean;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        onToggle(!checked);
      }}
      style={styles.optionRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
    >
      <MaterialIcons
        name={checked ? "check-box" : "check-box-outline-blank"}
        size={24}
        color={checked ? palette.tint : palette.icon}
        style={{ opacity: disabled ? 0.5 : 1, marginTop: 2 }}
      />
      <View style={styles.optionRowContent}>
        <Text
          style={[
            styles.optionLabel,
            { color: palette.text, opacity: disabled ? 0.6 : 1 },
          ]}
        >
          {label}
        </Text>
        {children}
      </View>
      {trailing}
    </Pressable>
  );
}

function Indented({ children }: { children: ReactNode }) {
  return <View style={styles.indented}>{children}</View>;
}

function NumberInput({
  value,
  onChange,
  palette,
  disabled,
  min = 0,
  suffix,
}: {
  value: number;
  onChange: (next: number) => void;
  palette: AccountTabPalette;
  disabled?: boolean;
  min?: number;
  suffix?: string;
}) {
  const clampValue = useCallback(
    (next: number) => {
      if (Number.isNaN(next)) return;
      onChange(Math.max(min, Math.floor(next)));
    },
    [min, onChange]
  );

  return (
    <View style={styles.numberInputContainer}>
      <Pressable
        onPress={() => clampValue(value - 1)}
        disabled={disabled}
        style={({ pressed }) => [
          styles.stepperButton,
          { opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={[styles.stepperText, { color: palette.text }]}>-</Text>
      </Pressable>
      <TextInput
        style={[
          styles.numberInput,
          { color: palette.text, borderColor: palette.icon + "33" },
        ]}
        value={String(value)}
        onChangeText={(text) => clampValue(Number(text))}
        editable={!disabled}
        keyboardType="number-pad"
        inputMode="numeric"
      />
      <Pressable
        onPress={() => clampValue(value + 1)}
        disabled={disabled}
        style={({ pressed }) => [
          styles.stepperButton,
          { opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={[styles.stepperText, { color: palette.text }]}>+</Text>
      </Pressable>
      {suffix ? (
        <Text
          style={[
            styles.numberSuffix,
            { color: palette.text, opacity: disabled ? 0.6 : 1 },
          ]}
        >
          {suffix}
        </Text>
      ) : null}
    </View>
  );
}

function PrimaryButton({
  label,
  palette,
  onPress,
  disabled,
}: {
  label: string;
  palette: AccountTabPalette;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const backgroundColor = palette.button?.background ?? palette.tint;
  const textColor = palette.button?.text ?? "#ffffff";
  return (
    <Pressable
      onPress={disabled ? undefined : () => void onPress()}
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

function SecondaryButton({
  label,
  palette,
  onPress,
}: {
  label: string;
  palette: AccountTabPalette;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      onPress={() => void onPress()}
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

// Use shared styles for consistency across tabs, with local extensions
const styles = {
  ...sharedTabStyles,
  countsLoadingContainer: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingVertical: 8,
  },
  countsLoadingText: {
    fontSize: 14,
  },
  reviewLabelContainer: {
    flex: 1,
    gap: 2,
  },
  reviewCount: {
    fontSize: 14,
    fontWeight: "500" as const,
  },
  reviewPostsButton: {
    alignSelf: "flex-start" as const,
    marginLeft: 28,
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 16,
  },
  reviewPostsButtonText: {
    fontSize: 13,
    fontWeight: "600" as const,
  },
};

export default DeleteTab;

import { MaterialIcons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { DeleteAutomationModal } from "@/app/account/components/DeleteAutomationModal";
import { FinishedModal } from "@/app/account/components/FinishedModal";
import {
  CheckboxRow,
  Indented,
  NumberInput,
  PrimaryButton,
  SecondaryButton,
  StackHeader,
  StatusCard,
} from "@/components/account/shared-tab-components";
import { sharedTabStyles } from "@/components/account/shared-tab-styles";
import { LastActionTimestamp } from "@/components/LastActionTimestamp";
import { PostsToDeleteReviewModal } from "@/components/PostsToDeleteReviewModal";
import { PremiumRequiredBanner } from "@/components/PremiumRequiredBanner";
import { PremiumRequiredModal } from "@/components/PremiumRequiredModal";
import { SaveStatusBanner } from "@/components/SaveStatusBanner";
import { useCydAccount } from "@/contexts/CydAccountProvider";
import { BlueskyAccountController } from "@/controllers";
import type { DeletionPreviewCounts } from "@/controllers/bluesky/deletion-calculator";
import type { BlueskyJobRecord } from "@/controllers/bluesky/job-types";
import { getLastSavedAt, setLastDeletedAt } from "@/database/accounts";
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
      value: AccountDeleteSettings[K],
    ) => {
      setPersistError(null);
      setState((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    [],
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
    [],
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
    [],
  );

  const showFinishedModalWithJobs = useCallback(
    (jobs: BlueskyJobRecord[]) => {
      // Submit progress to the server regardless of success/failure
      void submitBlueskyProgress(apiClient, accountId, accountUUID);

      // Update last deleted timestamp if any delete jobs completed
      const hadDeleteJobs = jobs.some(
        (j) =>
          (j.jobType.startsWith("delete") || j.jobType === "unfollowUsers") &&
          j.status === "completed",
      );
      if (hadDeleteJobs) {
        void setLastDeletedAt(accountId, Date.now());
      }

      setAutomationVisible(false);
      // Delay showing the FinishedModal to allow the DeleteAutomationModal to fully dismiss
      setTimeout(() => {
        setFinishedJobs(jobs);
        setFinishedModalVisible(true);
      }, 350);
      // Refresh the review screen counts
      setRefreshKey((prev) => prev + 1);
    },
    [apiClient, accountId, accountUUID],
  );

  const handleAutomationFinished = useCallback(
    (_result: "completed" | "failed", jobs: BlueskyJobRecord[]) => {
      showFinishedModalWithJobs(jobs);
    },
    [showFinishedModalWithJobs],
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

  const handleAutomationClose = useCallback(
    (jobs: BlueskyJobRecord[]) => {
      showFinishedModalWithJobs(jobs);
    },
    [showFinishedModalWithJobs],
  );

  const handleAutomationRestart = useCallback(
    (jobs: BlueskyJobRecord[]) => {
      const hasCompletedWork = jobs.some(
        (j) => j.jobType !== "verifyAuthorization" && j.status === "completed",
      );
      if (hasCompletedWork) {
        showFinishedModalWithJobs(jobs);
      } else {
        setAutomationVisible(false);
        resetToForm();
      }
    },
    [showFinishedModalWithJobs, resetToForm],
  );

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
    value: AccountDeleteSettings[K],
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
    undefined,
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
                  hint={!state.deletePosts ? "enable for options" : undefined}
                />
                {state.deletePosts && (
                  <Indented>
                    <CheckboxRow
                      palette={palette}
                      label="older than"
                      checked={state.deletePostsDaysOldEnabled}
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
                          disabled={!state.deletePostsDaysOldEnabled}
                          min={0}
                          suffix="days"
                        />
                      </View>
                    </CheckboxRow>
                    <CheckboxRow
                      palette={palette}
                      label="unless they have at least"
                      checked={state.deletePostsLikesThresholdEnabled}
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
                          disabled={!state.deletePostsLikesThresholdEnabled}
                          min={0}
                          suffix="likes"
                        />
                      </View>
                    </CheckboxRow>
                    <CheckboxRow
                      palette={palette}
                      label="or at least"
                      checked={state.deletePostsRepostsThresholdEnabled}
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
                          disabled={!state.deletePostsRepostsThresholdEnabled}
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
                        !state.deletePostsLikesThresholdEnabled &&
                        !state.deletePostsRepostsThresholdEnabled
                      }
                      onToggle={(next) =>
                        onUpdate("deletePostsPreserveThreads", next)
                      }
                    />
                  </Indented>
                )}

                <CheckboxRow
                  palette={palette}
                  label="Delete my reposts"
                  checked={state.deleteReposts}
                  onToggle={(next) => onUpdate("deleteReposts", next)}
                  hint={!state.deleteReposts ? "enable for options" : undefined}
                />
                {state.deleteReposts && (
                  <Indented>
                    <CheckboxRow
                      palette={palette}
                      label="older than"
                      checked={state.deleteRepostsDaysOldEnabled}
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
                          disabled={!state.deleteRepostsDaysOldEnabled}
                          min={0}
                          suffix="days"
                        />
                      </View>
                    </CheckboxRow>
                  </Indented>
                )}

                <CheckboxRow
                  palette={palette}
                  label="Delete my likes"
                  checked={state.deleteLikes}
                  onToggle={(next) => onUpdate("deleteLikes", next)}
                  hint={!state.deleteLikes ? "enable for options" : undefined}
                />
                {state.deleteLikes && (
                  <Indented>
                    <CheckboxRow
                      palette={palette}
                      label="older than"
                      checked={state.deleteLikesDaysOldEnabled}
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
                          disabled={!state.deleteLikesDaysOldEnabled}
                          min={0}
                          suffix="days"
                        />
                      </View>
                    </CheckboxRow>
                  </Indented>
                )}

                <CheckboxRow
                  palette={palette}
                  label="Delete my chat messages"
                  checked={state.deleteChats}
                  onToggle={(next) => onUpdate("deleteChats", next)}
                  hint={!state.deleteChats ? "enable for options" : undefined}
                />
                {state.deleteChats && (
                  <Indented>
                    <CheckboxRow
                      palette={palette}
                      label="older than"
                      checked={state.deleteChatsDaysOldEnabled}
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
                          disabled={!state.deleteChatsDaysOldEnabled}
                          min={0}
                          suffix="days"
                        />
                      </View>
                    </CheckboxRow>
                  </Indented>
                )}

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

        <LastActionTimestamp
          accountId={accountId}
          palette={palette}
          actionType="delete"
          refreshKey={refreshKey}
        />
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
    counts: DeletionPreviewCounts,
  ) => void;
  onPremiumRequired: (
    settings: AccountDeleteSettings,
    counts: DeletionPreviewCounts,
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
  const { state: cydState } = useCydAccount();
  const [counts, setCounts] = useState<DeletionPreviewCounts | null>(null);
  const [countsLoading, setCountsLoading] = useState(true);
  const [countsError, setCountsError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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
            err instanceof Error ? err.message : "Failed to calculate counts",
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
  const handleDeletePress = useCallback(() => {
    if (!counts) return;

    // If not signed in, show premium modal
    if (!cydState.isSignedIn) {
      onPremiumRequired(selections, counts);
      return;
    }

    // Check if user has premium (from context state)
    if (cydState.hasPremiumAccess === true) {
      // Has premium, proceed with deletion
      onConfirm(selections, counts);
    } else {
      // No premium or unknown, show the modal
      onPremiumRequired(selections, counts);
    }
  }, [
    counts,
    cydState.isSignedIn,
    cydState.hasPremiumAccess,
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
          Here’s what Cyd will delete from your Bluesky account:
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
          label="Delete My Data"
          onPress={handleDeletePress}
          disabled={chosen.length === 0 || !counts}
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

import { MaterialIcons } from "@expo/vector-icons";
import {
  useCallback,
  useEffect,
  useMemo,
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

import { PremiumRequiredBanner } from "@/components/PremiumRequiredBanner";
import {
  getAccountDeleteSettings,
  updateAccountDeleteSettings,
  type AccountDeleteSettings,
} from "@/database/delete-settings";
import type { AccountTabPalette, AccountTabProps } from "@/types/account-tabs";
import { sharedTabStyles } from "./shared-tab-styles";

type DeleteFlowScreen = "form" | "review";

export function DeleteTab({ accountId, handle, palette }: AccountTabProps) {
  const [screenStack, setScreenStack] = useState<DeleteFlowScreen[]>(["form"]);
  const [state, setState] = useState<AccountDeleteSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);

  const currentScreen = screenStack[screenStack.length - 1];

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

  const handleDelete = useCallback(() => {
    // Placeholder: future automation hook
  }, []);

  return (
    <View style={styles.container}>
      {currentScreen === "form" && (
        <DeleteOptionsForm
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
        />
      )}
      {currentScreen === "review" && state && (
        <DeleteReviewScreen
          palette={palette}
          selections={state}
          onBack={popScreen}
          onConfirm={handleDelete}
        />
      )}
    </View>
  );
}

type DeleteOptionsFormProps = {
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
};

function DeleteOptionsForm({
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
}: DeleteOptionsFormProps) {
  return (
    <View style={styles.stackScreen}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <PremiumRequiredBanner palette={palette} />

        <Text style={[styles.headline, { color: palette.text }]}>
          Choose what to delete
        </Text>
        <Text style={[styles.subhead, { color: palette.icon }]}>
          What data would you like Cyd to delete for you?
        </Text>

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
                onToggle={(next) => onUpdate("deletePostsDaysOldEnabled", next)}
              >
                <View style={styles.inlineNumberRow}>
                  <NumberInput
                    palette={palette}
                    value={state.deletePostsDaysOld}
                    onChange={(value) => onUpdate("deletePostsDaysOld", value)}
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
                      !state.deleteReposts || !state.deleteRepostsDaysOldEnabled
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
                onToggle={(next) => onUpdate("deleteLikesDaysOldEnabled", next)}
              >
                <View style={styles.inlineNumberRow}>
                  <NumberInput
                    palette={palette}
                    value={state.deleteLikesDaysOld}
                    onChange={(value) => onUpdate("deleteLikesDaysOld", value)}
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
                onToggle={(next) => onUpdate("deleteChatsDaysOldEnabled", next)}
              >
                <View style={styles.inlineNumberRow}>
                  <NumberInput
                    palette={palette}
                    value={state.deleteChatsDaysOld}
                    onChange={(value) => onUpdate("deleteChatsDaysOld", value)}
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

type DeleteReviewScreenProps = {
  palette: AccountTabPalette;
  selections: AccountDeleteSettings;
  onBack: () => void;
  onConfirm: () => void;
};

function DeleteReviewScreen({
  palette,
  selections,
  onBack,
  onConfirm,
}: DeleteReviewScreenProps) {
  const chosen: string[] = [];

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

    chosen.push(message);
  }

  if (selections.deleteReposts) {
    let message = selections.deleteRepostsDaysOldEnabled
      ? "Delete reposts"
      : "Delete all reposts";
    if (selections.deleteRepostsDaysOldEnabled) {
      message += ` older than ${selections.deleteRepostsDaysOld} days`;
    }
    chosen.push(message);
  }

  if (selections.deleteLikes) {
    let message = selections.deleteLikesDaysOldEnabled
      ? "Delete likes"
      : "Delete all likes";
    if (selections.deleteLikesDaysOldEnabled) {
      message += ` older than ${selections.deleteLikesDaysOld} days`;
    }
    chosen.push(message);
  }

  if (selections.deleteBookmarks) {
    chosen.push("Delete all bookmarks");
  }

  if (selections.deleteChats) {
    let message = selections.deleteChatsDaysOldEnabled
      ? "Delete chat messages"
      : "Delete all chat messages";
    if (selections.deleteChatsDaysOldEnabled) {
      message += ` older than ${selections.deleteChatsDaysOld} days`;
    }
    chosen.push(message);
  }

  if (selections.deleteUnfollowEveryone) {
    chosen.push("Unfollow everyone");
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
          {chosen.length === 0 ? (
            <Text style={[styles.reviewLabel, { color: palette.icon }]}>
              No data selected for deletion.
            </Text>
          ) : (
            chosen.map((label) => {
              const isChatMessage = label
                .toLowerCase()
                .includes("chat message");
              return (
                <View key={label}>
                  <View style={sharedTabStyles.reviewRow}>
                    <MaterialIcons
                      name="check-circle"
                      size={20}
                      color={palette.tint}
                      style={sharedTabStyles.reviewIcon}
                    />
                    <Text
                      style={[
                        sharedTabStyles.reviewLabel,
                        { color: palette.text },
                      ]}
                    >
                      {label}
                    </Text>
                  </View>
                  {isChatMessage && (
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
          label="Delete My Data"
          onPress={onConfirm}
          disabled={chosen.length === 0}
          palette={palette}
        />
      </View>
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

// Use shared styles for consistency across tabs
const styles = sharedTabStyles;

export default DeleteTab;

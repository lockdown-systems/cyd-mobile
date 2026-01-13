import { MaterialIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { DeleteReviewList } from "@/app/account/components/DeleteReviewList";
import { SaveReviewList } from "@/app/account/components/SaveReviewList";
import { LastActionTimestamp } from "@/components/LastActionTimestamp";
import { PremiumRequiredBanner } from "@/components/PremiumRequiredBanner";
import { SaveAndDeleteStatusBanner } from "@/components/SaveAndDeleteStatusBanner";
import { getLastDeletedAt, getLastSavedAt } from "@/database/accounts";
import type { AccountDeleteSettings } from "@/database/delete-settings";
import { getAccountDeleteSettings } from "@/database/delete-settings";
import type { AccountSaveSettings } from "@/database/save-settings";
import { getAccountSaveSettings } from "@/database/save-settings";
import {
  getAccountScheduleSettings,
  updateAccountScheduleSettings,
  type AccountScheduleSettings,
  type ScheduleFrequency,
} from "@/database/schedule-settings";
import type {
  AccountTabKey,
  AccountTabPalette,
  AccountTabProps,
} from "@/types/account-tabs";
import { dropdownMenuShadow, sharedTabStyles } from "./_shared-tab-styles";

const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const FREQUENCY_OPTIONS: { value: ScheduleFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const DAY_OF_MONTH_OPTIONS = Array.from({ length: 28 }, (_, i) => ({
  value: i + 1,
  label: `${i + 1}`,
}));

type ScheduleFlowScreen = "form" | "review";

export function ScheduleTab({
  accountId,
  palette,
  onSelectTab,
}: AccountTabProps) {
  const [screenStack, setScreenStack] = useState<ScheduleFlowScreen[]>([
    "form",
  ]);
  const [state, setState] = useState<AccountScheduleSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);

  // Save and delete settings for review screen
  const [saveSettings, setSaveSettings] = useState<AccountSaveSettings | null>(
    null
  );
  const [deleteSettings, setDeleteSettings] =
    useState<AccountDeleteSettings | null>(null);

  const currentScreen = screenStack[screenStack.length - 1];

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [scheduleSettings, save, del] = await Promise.all([
        getAccountScheduleSettings(accountId),
        getAccountSaveSettings(accountId),
        getAccountDeleteSettings(accountId),
      ]);
      setState(scheduleSettings);
      setSaveSettings(save);
      setDeleteSettings(del);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const updateSetting = useCallback(
    async <K extends keyof AccountScheduleSettings>(
      key: K,
      value: AccountScheduleSettings[K]
    ) => {
      if (!state) return;
      const newState = { ...state, [key]: value };
      setState(newState);

      // Auto-save to database
      setSaving(true);
      try {
        await updateAccountScheduleSettings(accountId, newState);
      } catch {
        // Revert on error
        setState(state);
      } finally {
        setSaving(false);
      }
    },
    [accountId, state]
  );

  const pushScreen = useCallback((next: ScheduleFlowScreen) => {
    setScreenStack((prev) => [...prev, next]);
  }, []);

  const popScreen = useCallback(() => {
    setScreenStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  // Check if any save or delete options are selected
  const hasSaveOptions = saveSettings
    ? saveSettings.posts ||
      saveSettings.likes ||
      saveSettings.bookmarks ||
      saveSettings.chat
    : false;

  const hasDeleteOptions = deleteSettings
    ? deleteSettings.deletePosts ||
      deleteSettings.deleteReposts ||
      deleteSettings.deleteLikes ||
      deleteSettings.deleteBookmarks ||
      deleteSettings.deleteChats ||
      deleteSettings.deleteUnfollowEveryone
    : false;

  const canProceed = hasSaveOptions || hasDeleteOptions;

  return (
    <View style={styles.container}>
      {currentScreen === "form" && (
        <ScheduleOptionsForm
          accountId={accountId}
          palette={palette}
          state={state}
          loading={loading}
          error={error}
          saving={saving}
          canProceed={canProceed}
          onSelectTab={onSelectTab}
          onRetry={loadSettings}
          onUpdateSetting={updateSetting}
          onContinue={() => pushScreen("review")}
        />
      )}
      {currentScreen === "review" &&
        state &&
        saveSettings &&
        deleteSettings && (
          <ScheduleReviewScreen
            palette={palette}
            saveSettings={saveSettings}
            deleteSettings={deleteSettings}
            onBack={popScreen}
            onSelectTab={onSelectTab}
          />
        )}
    </View>
  );
}

type ScheduleOptionsFormProps = {
  accountId: number;
  palette: AccountTabPalette;
  state: AccountScheduleSettings | null;
  loading: boolean;
  error: Error | null;
  saving: boolean;
  canProceed: boolean;
  onSelectTab?: (tab: AccountTabKey) => void;
  onRetry: () => void | Promise<void>;
  onUpdateSetting: <K extends keyof AccountScheduleSettings>(
    key: K,
    value: AccountScheduleSettings[K]
  ) => Promise<void>;
  onContinue: () => void;
};

function ScheduleOptionsForm({
  accountId,
  palette,
  state,
  loading,
  error,
  saving,
  canProceed,
  onSelectTab,
  onRetry,
  onUpdateSetting,
  onContinue,
}: ScheduleOptionsFormProps) {
  const [lastSavedAt, setLastSavedAt] = useState<number | null | undefined>(
    undefined
  );
  const [lastDeletedAt, setLastDeletedAt] = useState<number | null | undefined>(
    undefined
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const savedTs = await getLastSavedAt(accountId);
      if (!cancelled) {
        setLastSavedAt(savedTs);
      }
      const deletedTs = await getLastDeletedAt(accountId);
      if (!cancelled) {
        setLastDeletedAt(deletedTs);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const hasSavedAndDeletedData =
    lastSavedAt !== undefined &&
    lastDeletedAt !== undefined &&
    lastSavedAt !== null &&
    lastDeletedAt !== null;

  return (
    <View style={styles.stackScreen}>
      <PremiumRequiredBanner palette={palette} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.headline, { color: palette.text }]}>
          Schedule deletion
        </Text>
        <Text style={[styles.subhead, { color: palette.icon }]}>
          On a regular basis, you&apos;ll get a notification to save the new
          data in your Bluesky account, and then automatically delete your data
          based on your settings.
        </Text>
        <Text style={[styles.subhead, { color: palette.icon }]}>
          Would you like to get reminded to delete your data?
        </Text>

        <SaveAndDeleteStatusBanner
          accountId={accountId}
          palette={palette}
          onSelectTab={onSelectTab}
        />

        {hasSavedAndDeletedData && (
          <>
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator color={palette.tint} size="large" />
                <Text style={[styles.loadingText, { color: palette.icon }]}>
                  Loading your current settings…
                </Text>
              </View>
            ) : error ? (
              <View
                style={[
                  styles.errorContainer,
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
                <Text style={[styles.errorText, { color: palette.icon }]}>
                  Failed to load your existing preferences.
                </Text>
                <Pressable
                  onPress={() => void onRetry()}
                  style={[
                    styles.retryButton,
                    { borderColor: palette.icon + "33" },
                  ]}
                >
                  <Text
                    style={[styles.retryButtonText, { color: palette.text }]}
                  >
                    Try again
                  </Text>
                </Pressable>
              </View>
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
                  label="Remind me to delete my data"
                  checked={state.scheduleDeletion}
                  onToggle={(next) =>
                    void onUpdateSetting("scheduleDeletion", next)
                  }
                  hint={
                    !state.scheduleDeletion ? "enable for options" : undefined
                  }
                />
                {state.scheduleDeletion && (
                  <View style={styles.indented}>
                    <FrequencyPicker
                      palette={palette}
                      value={state.scheduleDeletionFrequency}
                      onChange={(value) =>
                        void onUpdateSetting("scheduleDeletionFrequency", value)
                      }
                    />

                    {state.scheduleDeletionFrequency === "monthly" && (
                      <DropdownRow
                        palette={palette}
                        label="Day of month"
                        value={state.scheduleDeletionDayOfMonth}
                        options={DAY_OF_MONTH_OPTIONS}
                        onChange={(value) =>
                          void onUpdateSetting(
                            "scheduleDeletionDayOfMonth",
                            value
                          )
                        }
                      />
                    )}

                    {state.scheduleDeletionFrequency === "weekly" && (
                      <DayOfWeekPicker
                        palette={palette}
                        value={state.scheduleDeletionDayOfWeek}
                        onChange={(value) =>
                          void onUpdateSetting(
                            "scheduleDeletionDayOfWeek",
                            value
                          )
                        }
                      />
                    )}

                    <TimePicker
                      palette={palette}
                      value={state.scheduleDeletionTime}
                      onChange={(value) =>
                        void onUpdateSetting("scheduleDeletionTime", value)
                      }
                    />

                    {saving && (
                      <View style={styles.savingIndicator}>
                        <ActivityIndicator size="small" color={palette.tint} />
                        <Text
                          style={[styles.savingText, { color: palette.icon }]}
                        >
                          Saving...
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            ) : null}
          </>
        )}

        <LastActionTimestamp
          accountId={accountId}
          palette={palette}
          actionType="schedule"
        />
      </ScrollView>
      {hasSavedAndDeletedData && (
        <View
          style={[
            styles.footerBar,
            {
              borderColor: palette.icon + "22",
              backgroundColor: palette.background,
            },
          ]}
        >
          <PrimaryButton
            label="Save and Delete Data Now"
            onPress={onContinue}
            disabled={!canProceed || loading}
            palette={palette}
          />
        </View>
      )}
    </View>
  );
}

type ScheduleReviewScreenProps = {
  palette: AccountTabPalette;
  saveSettings: AccountSaveSettings;
  deleteSettings: AccountDeleteSettings;
  onBack: () => void;
  onSelectTab?: (tab: AccountTabKey) => void;
};

function ScheduleReviewScreen({
  palette,
  saveSettings,
  deleteSettings,
  onBack,
  onSelectTab,
}: ScheduleReviewScreenProps) {
  return (
    <View style={styles.stackScreen}>
      <StackHeader
        title="Ready to save and delete your Bluesky data?"
        palette={palette}
        onBack={onBack}
      />
      <ScrollView contentContainerStyle={styles.reviewContent}>
        <Text style={[styles.reviewIntro, { color: palette.text }]}>
          Here&apos;s what Cyd will save on this device:
        </Text>
        <View style={[styles.reviewCard, { borderColor: palette.icon + "22" }]}>
          <SaveReviewList
            selections={{
              posts: saveSettings.posts,
              likes: saveSettings.likes,
              bookmarks: saveSettings.bookmarks,
              chat: saveSettings.chat,
            }}
            palette={palette}
          />
        </View>
        <Text style={[styles.reviewSubtext, { color: palette.icon }]}>
          To change this, go to{" "}
          <Text
            style={[localStyles.linkText, { color: palette.tint }]}
            onPress={() => onSelectTab?.("save")}
          >
            save options
          </Text>
          .
        </Text>

        <View style={{ height: 20 }} />

        <Text style={[styles.reviewIntro, { color: palette.text }]}>
          Here&apos;s what Cyd will delete from your Bluesky account:
        </Text>
        <View style={[styles.reviewCard, { borderColor: palette.icon + "22" }]}>
          <DeleteReviewList selections={deleteSettings} palette={palette} />
        </View>
        <Text style={[styles.reviewSubtext, { color: palette.icon }]}>
          To change this, go to{" "}
          <Text
            style={[localStyles.linkText, { color: palette.tint }]}
            onPress={() => onSelectTab?.("delete")}
          >
            delete options
          </Text>
          .
        </Text>
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
          label="Back to Schedule Options"
          onPress={onBack}
          palette={palette}
        />
        <PrimaryButton
          label="Save and Delete Data Now"
          onPress={() => {
            // TODO: Implement save and delete automation
          }}
          disabled={false}
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

function CheckboxRow({
  label,
  checked,
  onToggle,
  palette,
  hint,
}: {
  label: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
  palette: AccountTabPalette;
  hint?: string;
}) {
  return (
    <Pressable
      onPress={() => onToggle(!checked)}
      style={styles.optionRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <MaterialIcons
        name={checked ? "check-box" : "check-box-outline-blank"}
        size={24}
        color={checked ? palette.tint : palette.icon}
        style={{ marginTop: 2 }}
      />
      <View style={styles.optionRowContent}>
        <View style={styles.optionLabelRow}>
          <Text style={[styles.optionLabel, { color: palette.text }]}>
            {label}
          </Text>
        </View>
        {hint && (
          <Text style={[styles.optionHint, { color: palette.icon }]}>
            {hint}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function FrequencyPicker({
  value,
  onChange,
  palette,
}: {
  value: ScheduleFrequency;
  onChange: (value: ScheduleFrequency) => void;
  palette: AccountTabPalette;
}) {
  return (
    <View style={localStyles.frequencyContainer}>
      <Text style={[styles.dropdownLabel, { color: palette.text }]}>
        Frequency
      </Text>
      <View
        style={[
          localStyles.frequencyButtonRow,
          {
            borderColor: palette.icon + "33",
            backgroundColor: palette.background,
          },
        ]}
      >
        {FREQUENCY_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[
              localStyles.frequencyButton,
              value === option.value && {
                backgroundColor: palette.button?.background ?? palette.tint,
              },
            ]}
          >
            <Text
              style={[
                localStyles.frequencyButtonText,
                {
                  color:
                    value === option.value
                      ? (palette.button?.text ?? "#fff")
                      : palette.text,
                },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function DayOfWeekPicker({
  value,
  onChange,
  palette,
}: {
  value: number;
  onChange: (value: number) => void;
  palette: AccountTabPalette;
}) {
  // Map display index (0=Mon, 1=Tue, ..., 6=Sun) to database value (0=Sun, 1=Mon, ...)
  const displayIndexToValue = (displayIndex: number): number => {
    return displayIndex === 6 ? 0 : displayIndex + 1;
  };

  // Build options with Monday first, Sunday last
  const options = DAYS_OF_WEEK.map((day, displayIndex) => ({
    label: day,
    value: displayIndexToValue(displayIndex),
  }));

  return (
    <DropdownRow
      label="Day of week"
      value={value}
      options={options}
      onChange={onChange}
      palette={palette}
    />
  );
}

function TimePicker({
  value,
  onChange,
  palette,
}: {
  value: string;
  onChange: (value: string) => void;
  palette: AccountTabPalette;
}) {
  const [showPicker, setShowPicker] = useState(Platform.OS === "ios");

  // Parse time string (e.g., "09:00") to Date
  const timeToDate = (timeStr: string): Date => {
    const [hours, minutes] = timeStr.split(":").map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  };

  // Convert Date to time string
  const dateToTime = (date: Date): string => {
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
  };

  const handleChange = (event: unknown, selectedDate?: Date) => {
    if (Platform.OS === "android") {
      setShowPicker(false);
    }
    if (selectedDate) {
      onChange(dateToTime(selectedDate));
    }
  };

  // Format time for display (e.g., "9:00 AM")
  const formatTimeDisplay = (timeStr: string): string => {
    const [hours, minutes] = timeStr.split(":").map(Number);
    const period = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, "0")} ${period}`;
  };

  return (
    <View style={localStyles.timePickerContainer}>
      <Text style={[styles.dropdownLabel, { color: palette.text }]}>Time</Text>

      {Platform.OS === "android" && (
        <Pressable
          onPress={() => setShowPicker(true)}
          style={[
            localStyles.timeButton,
            {
              borderColor: palette.icon + "33",
              backgroundColor: palette.background,
            },
          ]}
        >
          <MaterialIcons name="schedule" size={20} color={palette.icon} />
          <Text style={[localStyles.timeButtonText, { color: palette.text }]}>
            {formatTimeDisplay(value)}
          </Text>
        </Pressable>
      )}

      {Platform.OS === "ios" && (
        <View style={localStyles.timePickerRow}>
          <DateTimePicker
            value={timeToDate(value)}
            mode="time"
            onChange={handleChange}
            display="compact"
            accentColor={palette.tint}
          />
        </View>
      )}

      {Platform.OS === "android" && showPicker && (
        <DateTimePicker
          value={timeToDate(value)}
          mode="time"
          is24Hour={false}
          onChange={handleChange}
          display="default"
          themeVariant="light"
        />
      )}
    </View>
  );
}

function DropdownRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
  palette,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  palette: AccountTabPalette;
}) {
  const [expanded, setExpanded] = useState(false);
  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <View style={styles.dropdownContainer}>
      <Text style={[styles.dropdownLabel, { color: palette.text }]}>
        {label}
      </Text>
      <Pressable
        onPress={() => setExpanded(!expanded)}
        style={[
          styles.dropdownButton,
          {
            borderColor: palette.icon + "33",
            backgroundColor: palette.background,
          },
        ]}
      >
        <Text style={[styles.dropdownButtonText, { color: palette.text }]}>
          {selectedOption?.label ?? "Select..."}
        </Text>
        <MaterialIcons
          name={expanded ? "keyboard-arrow-up" : "keyboard-arrow-down"}
          size={20}
          color={palette.icon}
        />
      </Pressable>
      {expanded && (
        <View
          style={[
            styles.dropdownMenu,
            {
              borderColor: palette.icon + "33",
              backgroundColor: palette.background,
              ...dropdownMenuShadow,
            },
          ]}
        >
          <ScrollView style={styles.dropdownScroll} nestedScrollEnabled>
            {options.map((option) => (
              <Pressable
                key={String(option.value)}
                onPress={() => {
                  onChange(option.value);
                  setExpanded(false);
                }}
                style={[
                  styles.dropdownItem,
                  option.value === value && {
                    backgroundColor: palette.tint + "20",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.dropdownItemText,
                    { color: palette.text },
                    option.value === value && { fontWeight: "600" },
                  ]}
                >
                  {option.label}
                </Text>
                {option.value === value && (
                  <MaterialIcons name="check" size={18} color={palette.tint} />
                )}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
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

// Use shared styles for consistency across tabs, with local extensions
const styles = {
  ...sharedTabStyles,
  // Use indentedWithPadding for schedule tab's indented section, with extra right padding
  indented: {
    ...sharedTabStyles.indentedWithPadding,
    paddingRight: 12,
  },
};

const localStyles = StyleSheet.create({
  frequencyContainer: {
    gap: 6,
  },
  frequencyButtonRow: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  frequencyButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
  },
  frequencyButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },

  timePickerContainer: {
    gap: 6,
  },
  timePickerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  timeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  timeButtonText: {
    fontSize: 15,
  },
  linkText: {
    textDecorationLine: "underline",
  },
});

export default ScheduleTab;

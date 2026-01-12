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

import { LastActionTimestamp } from "@/components/LastActionTimestamp";
import { PremiumRequiredBanner } from "@/components/PremiumRequiredBanner";
import { SaveAndDeleteStatusBanner } from "@/components/SaveAndDeleteStatusBanner";
import {
  getAccountScheduleSettings,
  updateAccountScheduleSettings,
  type AccountScheduleSettings,
  type ScheduleFrequency,
} from "@/database/schedule-settings";
import type { AccountTabPalette, AccountTabProps } from "@/types/account-tabs";
import { dropdownMenuShadow, sharedTabStyles } from "./shared-tab-styles";

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

export function ScheduleTab({
  accountId,
  palette,
  onSelectTab,
}: AccountTabProps) {
  const [state, setState] = useState<AccountScheduleSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const settings = await getAccountScheduleSettings(accountId);
      setState(settings);
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

  return (
    <View style={styles.container}>
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
              onPress={() => void loadSettings()}
              style={[styles.retryButton, { borderColor: palette.icon + "33" }]}
            >
              <Text style={[styles.retryButtonText, { color: palette.text }]}>
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
              onToggle={(next) => void updateSetting("scheduleDeletion", next)}
              hint={!state.scheduleDeletion ? "enable for options" : undefined}
            />
            {state.scheduleDeletion && (
              <View style={styles.indented}>
                <FrequencyPicker
                  palette={palette}
                  value={state.scheduleDeletionFrequency}
                  onChange={(value) =>
                    void updateSetting("scheduleDeletionFrequency", value)
                  }
                />

                {state.scheduleDeletionFrequency === "monthly" && (
                  <DropdownRow
                    palette={palette}
                    label="Day of month"
                    value={state.scheduleDeletionDayOfMonth}
                    options={DAY_OF_MONTH_OPTIONS}
                    onChange={(value) =>
                      void updateSetting("scheduleDeletionDayOfMonth", value)
                    }
                  />
                )}

                {state.scheduleDeletionFrequency === "weekly" && (
                  <DayOfWeekPicker
                    palette={palette}
                    value={state.scheduleDeletionDayOfWeek}
                    onChange={(value) =>
                      void updateSetting("scheduleDeletionDayOfWeek", value)
                    }
                  />
                )}

                <TimePicker
                  palette={palette}
                  value={state.scheduleDeletionTime}
                  onChange={(value) =>
                    void updateSetting("scheduleDeletionTime", value)
                  }
                />

                {saving && (
                  <View style={styles.savingIndicator}>
                    <ActivityIndicator size="small" color={palette.tint} />
                    <Text style={[styles.savingText, { color: palette.icon }]}>
                      Saving...
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        ) : null}

        <LastActionTimestamp
          accountId={accountId}
          palette={palette}
          actionType="schedule"
        />
      </ScrollView>
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
                backgroundColor: palette.tint,
              },
            ]}
          >
            <Text
              style={[
                localStyles.frequencyButtonText,
                { color: value === option.value ? "#fff" : palette.text },
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
            themeVariant="light"
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
});

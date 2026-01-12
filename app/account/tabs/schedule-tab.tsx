import { MaterialIcons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
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
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const FREQUENCY_OPTIONS: { value: ScheduleFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const TIME_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const hour = i.toString().padStart(2, "0");
  return { value: `${hour}:00`, label: `${hour}:00` };
});

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
          When would you like to get reminded to delete your data?
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
                <DropdownRow
                  palette={palette}
                  label="Frequency"
                  value={state.scheduleDeletionFrequency}
                  options={FREQUENCY_OPTIONS}
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
                  <DropdownRow
                    palette={palette}
                    label="Day of week"
                    value={state.scheduleDeletionDayOfWeek}
                    options={DAYS_OF_WEEK.map((day, i) => ({
                      value: i,
                      label: day,
                    }))}
                    onChange={(value) =>
                      void updateSetting("scheduleDeletionDayOfWeek", value)
                    }
                  />
                )}

                <DropdownRow
                  palette={palette}
                  label="Time"
                  value={state.scheduleDeletionTime}
                  options={TIME_OPTIONS}
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
  // Use indentedWithPadding for schedule tab's indented section
  indented: sharedTabStyles.indentedWithPadding,
};

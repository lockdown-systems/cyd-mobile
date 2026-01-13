import { MaterialIcons } from "@expo/vector-icons";
import React, { useCallback, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import type { AccountTabPalette } from "@/types/account-tabs";
import { sharedTabStyles } from "./_shared-tab-styles";

const styles = sharedTabStyles;

// -----------------------------------------------------------------------------
// PrimaryButton
// -----------------------------------------------------------------------------

export type PrimaryButtonProps = {
  label: string;
  palette: AccountTabPalette;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
};

export function PrimaryButton({
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

// -----------------------------------------------------------------------------
// SecondaryButton
// -----------------------------------------------------------------------------

export type SecondaryButtonProps = {
  label: string;
  palette: AccountTabPalette;
  onPress: () => void | Promise<void>;
};

export function SecondaryButton({
  label,
  palette,
  onPress,
}: SecondaryButtonProps) {
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

// -----------------------------------------------------------------------------
// StackHeader
// -----------------------------------------------------------------------------

export type StackHeaderProps = {
  title: string;
  palette: AccountTabPalette;
  onBack: () => void;
};

export function StackHeader({ title, palette, onBack }: StackHeaderProps) {
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

// -----------------------------------------------------------------------------
// CheckboxRow
// -----------------------------------------------------------------------------

export type CheckboxRowProps = {
  label: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
  palette: AccountTabPalette;
  disabled?: boolean;
  trailing?: ReactNode;
  children?: ReactNode;
  hint?: string;
};

export function CheckboxRow({
  label,
  checked,
  onToggle,
  palette,
  disabled,
  trailing,
  children,
  hint,
}: CheckboxRowProps) {
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
        <View style={styles.optionLabelRow}>
          <Text
            style={[
              styles.optionLabel,
              { color: palette.text, opacity: disabled ? 0.6 : 1 },
            ]}
          >
            {label}
          </Text>
        </View>
        {hint && (
          <Text style={[styles.optionHint, { color: palette.icon }]}>
            {hint}
          </Text>
        )}
        {children}
      </View>
      {trailing}
    </Pressable>
  );
}

// -----------------------------------------------------------------------------
// StatusCard
// -----------------------------------------------------------------------------

export type StatusCardProps = {
  children: ReactNode;
  palette: AccountTabPalette;
};

export function StatusCard({ children, palette }: StatusCardProps) {
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

// -----------------------------------------------------------------------------
// Indented
// -----------------------------------------------------------------------------

export type IndentedProps = {
  children: ReactNode;
};

export function Indented({ children }: IndentedProps) {
  return <View style={styles.indented}>{children}</View>;
}

// -----------------------------------------------------------------------------
// NumberInput
// -----------------------------------------------------------------------------

export type NumberInputProps = {
  value: number;
  onChange: (next: number) => void;
  palette: AccountTabPalette;
  disabled?: boolean;
  min?: number;
  suffix?: string;
};

export function NumberInput({
  value,
  onChange,
  palette,
  disabled,
  min = 0,
  suffix,
}: NumberInputProps) {
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

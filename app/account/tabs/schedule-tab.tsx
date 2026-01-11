import { MaterialIcons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import type { AccountTabProps } from "@/types/account-tabs";

export function ScheduleTab({ palette }: AccountTabProps) {
  return (
    <View style={styles.container}>
      <MaterialIcons
        name="schedule"
        size={64}
        color={palette.icon}
        style={styles.icon}
      />
      <Text style={[styles.title, { color: palette.text }]}>
        Schedule Deletion
      </Text>
      <Text style={[styles.description, { color: palette.icon }]}>
        This feature is coming soon. You&apos;ll be able to schedule automatic
        deletion of your data based on your save and delete settings.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  icon: {
    marginBottom: 16,
    opacity: 0.6,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    marginBottom: 12,
    textAlign: "center",
  },
  description: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
  },
});

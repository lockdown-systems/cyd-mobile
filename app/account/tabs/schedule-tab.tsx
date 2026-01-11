import { ScrollView, StyleSheet, Text, View } from "react-native";

import { LastActionTimestamp } from "@/components/LastActionTimestamp";
import { PremiumRequiredBanner } from "@/components/PremiumRequiredBanner";
import { SaveAndDeleteStatusBanner } from "@/components/SaveAndDeleteStatusBanner";
import type { AccountTabProps } from "@/types/account-tabs";

export function ScheduleTab({
  accountId,
  palette,
  onSelectTab,
}: AccountTabProps) {
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

        <LastActionTimestamp
          accountId={accountId}
          palette={palette}
          actionType="schedule"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 0,
    paddingBottom: 32,
    gap: 16,
  },
  headline: {
    fontSize: 22,
    fontWeight: "700",
  },
  subhead: {
    fontSize: 16,
    lineHeight: 22,
  },
});

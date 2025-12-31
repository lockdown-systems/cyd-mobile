import { StyleSheet, Text, View } from "react-native";

import type { AccountTabPalette } from "@/types/account-tabs";

type BrowsePlaceholderCardProps = {
  title: string;
  message: string;
  palette: AccountTabPalette;
};

export function BrowsePlaceholderCard({
  title,
  message,
  palette,
}: BrowsePlaceholderCardProps) {
  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <Text style={[styles.cardTitle, { color: palette.text }]}>{title}</Text>
      <Text style={[styles.cardBody, { color: palette.icon }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 6,
  },
  cardBody: {
    fontSize: 15,
    lineHeight: 22,
  },
});

export default BrowsePlaceholderCard;

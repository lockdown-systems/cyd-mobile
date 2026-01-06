import { StyleSheet } from "react-native";

/**
 * Shared styles used across save-tab and delete-tab
 */
export const sharedTabStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  stackScreen: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
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
  optionCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingVertical: 4,
    gap: 4,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 12,
  },
  optionRowContent: {
    flex: 1,
    gap: 4,
  },
  optionLabel: {
    fontSize: 16,
    flex: 1,
  },
  inlineHint: {
    fontSize: 13,
  },
  inlineNumberRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
  },
  indented: {
    marginLeft: 28,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: "rgba(0, 0, 0, 0.1)",
    gap: 4,
  },
  footerBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    paddingBottom: 24,
    paddingHorizontal: 16,
    alignItems: "center",
    gap: 12,
  },
  statusCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    alignItems: "center",
  },
  statusText: {
    fontSize: 15,
    textAlign: "center",
  },
  statusTextDetail: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    opacity: 0.85,
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 12,
    marginBottom: 16,
  },
  backButton: {
    padding: 4,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  reviewContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 16,
  },
  reviewIntro: {
    fontSize: 16,
    lineHeight: 22,
  },
  reviewCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  reviewRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  reviewLabel: {
    fontSize: 16,
    fontWeight: "600",
  },
  reviewSubtext: {
    fontSize: 14,
    lineHeight: 20,
  },
  reviewIcon: {
    marginTop: 2,
  },
  infoCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    marginTop: 4,
    marginBottom: 4,
  },
  infoText: {
    fontSize: 16,
    lineHeight: 22,
  },
  primaryButton: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: "center",
    alignSelf: "center",
    minWidth: 220,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 32,
    alignSelf: "center",
    minWidth: 220,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  numberInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: "hidden",
  },
  numberInput: {
    minWidth: 60,
    textAlign: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
  },
  stepperButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  stepperText: {
    fontSize: 18,
    fontWeight: "700",
  },
  numberSuffix: {
    marginLeft: 8,
    paddingRight: 12,
    fontSize: 15,
    fontWeight: "500",
  },
});

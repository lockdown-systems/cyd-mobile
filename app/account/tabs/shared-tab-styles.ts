import { Platform, StyleSheet } from "react-native";

/**
 * Shared styles used across save-tab, delete-tab, and schedule-tab
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
  optionLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  optionLabel: {
    fontSize: 16,
    flex: 1,
  },
  optionHint: {
    fontSize: 12,
    fontStyle: "italic",
    opacity: 0.7,
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
  indentedWithPadding: {
    marginLeft: 28,
    paddingLeft: 12,
    paddingBottom: 12,
    borderLeftWidth: 2,
    borderLeftColor: "rgba(0, 0, 0, 0.1)",
    gap: 12,
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
  loadingContainer: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 24,
  },
  loadingText: {
    fontSize: 15,
  },
  errorContainer: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    alignItems: "center",
  },
  retryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: "500",
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
  bannerButtonRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
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
  // Dropdown styles
  dropdownContainer: {
    gap: 6,
  },
  dropdownLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  dropdownButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  dropdownButtonText: {
    fontSize: 15,
  },
  dropdownMenu: {
    borderWidth: 1,
    borderRadius: 8,
    marginTop: 4,
    overflow: "hidden",
  },
  dropdownScroll: {
    maxHeight: 200,
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  dropdownItemText: {
    fontSize: 15,
  },
  savingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  savingText: {
    fontSize: 13,
  },
});

// Platform-specific shadow for dropdown menus
export const dropdownMenuShadow = Platform.select({
  ios: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  android: {
    elevation: 4,
  },
});

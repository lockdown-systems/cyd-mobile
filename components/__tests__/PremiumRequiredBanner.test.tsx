/**
 * @fileoverview Tests for PremiumRequiredBanner component
 */

import { Colors } from "@/constants/theme";
import type { AccountTabPalette } from "@/types/account-tabs";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import React from "react";
import { Alert, Linking } from "react-native";
import { PremiumRequiredBanner } from "../PremiumRequiredBanner";

// Get the mocked useCydAccount to modify per test
import { useCydAccount } from "@/contexts/CydAccountProvider";

const defaultPalette: AccountTabPalette = Colors.light;

// Mock the useCydAccount hook
// Mock the useCydAccount hook
const mockApiClient = {
  getUserPremium: jest.fn(),
};

const mockGetDashboardURL = jest.fn(() => "https://dash.cyd.social/manage");

jest.mock("@/contexts/CydAccountProvider", () => ({
  useCydAccount: jest.fn(() => ({
    state: {
      isSignedIn: false,
      userEmail: null,
      isLoading: false,
    },
    apiClient: mockApiClient,
    getDashboardURL: mockGetDashboardURL,
  })),
}));

// Mock CydSignInModal
jest.mock("@/components/CydSignInModal", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  const { View, Text, Pressable } = require("react-native");
  return {
    CydSignInModal: ({
      visible,
      onClose,
    }: {
      visible: boolean;
      onClose: () => void;
    }) => {
      if (!visible) return null;
      return (
        <View testID="sign-in-modal">
          <Text>Sign In Modal</Text>
          <Pressable onPress={onClose} testID="modal-close">
            <Text>Close</Text>
          </Pressable>
        </View>
      );
    },
  };
});

// Mock CydAvatar
jest.mock("@/components/cyd/CydAvatar", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  const { View, Text } = require("react-native");
  return {
    CydAvatar: ({ height }: { height: number }) => {
      return (
        <View testID="cyd-avatar">
          <Text>Avatar {height}</Text>
        </View>
      );
    },
  };
});
const mockUseCydAccount = useCydAccount as jest.Mock;

describe("PremiumRequiredBanner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset to default signed out state
    mockUseCydAccount.mockReturnValue({
      state: {
        isSignedIn: false,
        userEmail: null,
        isLoading: false,
      },
      apiClient: mockApiClient,
      getDashboardURL: mockGetDashboardURL,
    });
  });

  describe("loading state", () => {
    it("should show loading indicator when checking account status", () => {
      mockUseCydAccount.mockReturnValue({
        state: {
          isSignedIn: false,
          userEmail: null,
          isLoading: true,
        },
        apiClient: mockApiClient,
        getDashboardURL: mockGetDashboardURL,
      });

      render(<PremiumRequiredBanner palette={defaultPalette} />);

      expect(screen.getByText("Checking account status…")).toBeTruthy();
      expect(screen.getByTestId("cyd-avatar")).toBeTruthy();
    });
  });

  describe("not signed in state", () => {
    it("should show sign in prompt when user is not signed in", () => {
      render(<PremiumRequiredBanner palette={defaultPalette} />);

      expect(
        screen.getByText(
          "Deleting data requires a Premium account. Sign in to get started."
        )
      ).toBeTruthy();
      expect(screen.getByText("Sign In")).toBeTruthy();
      expect(screen.getByTestId("cyd-avatar")).toBeTruthy();
    });

    it("should show hint text about exploring features", () => {
      render(<PremiumRequiredBanner palette={defaultPalette} />);

      expect(
        screen.getByText(
          "In the meantime, feel free to explore the delete features below."
        )
      ).toBeTruthy();
    });

    it("should open sign in modal when Sign In button is pressed", async () => {
      render(<PremiumRequiredBanner palette={defaultPalette} />);

      fireEvent.press(screen.getByText("Sign In"));

      await waitFor(() => {
        expect(screen.getByTestId("sign-in-modal")).toBeTruthy();
      });
    });

    it("should close sign in modal when close is triggered", async () => {
      render(<PremiumRequiredBanner palette={defaultPalette} />);

      // Open modal
      fireEvent.press(screen.getByText("Sign In"));

      await waitFor(() => {
        expect(screen.getByTestId("sign-in-modal")).toBeTruthy();
      });

      // Close modal
      fireEvent.press(screen.getByTestId("modal-close"));

      await waitFor(() => {
        expect(screen.queryByTestId("sign-in-modal")).toBeNull();
      });
    });
  });

  describe("signed in without premium state", () => {
    beforeEach(() => {
      mockUseCydAccount.mockReturnValue({
        state: {
          isSignedIn: true,
          userEmail: "test@example.com",
          isLoading: false,
        },
        apiClient: mockApiClient,
        getDashboardURL: mockGetDashboardURL,
      });
      mockApiClient.getUserPremium.mockResolvedValue({
        premium_access: false,
        has_individual_subscription: false,
      });
    });

    it("should show upgrade prompt when user has no premium access", async () => {
      render(<PremiumRequiredBanner palette={defaultPalette} />);

      await waitFor(() => {
        expect(
          screen.getByText(
            "Deleting data requires a Premium account. Manage your account to upgrade to Premium."
          )
        ).toBeTruthy();
      });
    });

    it("should show Manage My Account button", async () => {
      render(<PremiumRequiredBanner palette={defaultPalette} />);

      await waitFor(() => {
        expect(screen.getByText("Manage My Account")).toBeTruthy();
      });
    });

    it("should show I've Upgraded button", async () => {
      render(<PremiumRequiredBanner palette={defaultPalette} />);

      await waitFor(() => {
        expect(screen.getByText("I've Upgraded")).toBeTruthy();
      });
    });

    it("should open dashboard URL when Manage My Account is pressed", async () => {
      const mockOpenURL = jest
        .spyOn(Linking, "openURL")
        .mockResolvedValue(undefined);

      render(<PremiumRequiredBanner palette={defaultPalette} />);

      await waitFor(() => {
        expect(screen.getByText("Manage My Account")).toBeTruthy();
      });

      fireEvent.press(screen.getByText("Manage My Account"));

      expect(mockOpenURL).toHaveBeenCalledWith(
        "https://dash.cyd.social/manage"
      );
      mockOpenURL.mockRestore();
    });

    it("should check premium status when I've Upgraded is pressed", async () => {
      render(<PremiumRequiredBanner palette={defaultPalette} />);

      await waitFor(() => {
        expect(screen.getByText("I've Upgraded")).toBeTruthy();
      });

      fireEvent.press(screen.getByText("I've Upgraded"));

      await waitFor(() => {
        expect(mockApiClient.getUserPremium).toHaveBeenCalled();
      });
    });

    it("should show success alert when premium is now active", async () => {
      // Initial check returns no premium
      mockApiClient.getUserPremium.mockResolvedValueOnce({
        premium_access: false,
        has_individual_subscription: false,
      });

      render(<PremiumRequiredBanner palette={defaultPalette} />);

      // Wait for initial render (which shows no premium)
      await waitFor(() => {
        expect(screen.getByText("I've Upgraded")).toBeTruthy();
      });

      // Now mock that premium is active for the "I've Upgraded" check
      mockApiClient.getUserPremium.mockResolvedValueOnce({
        premium_access: true,
      });

      await act(async () => {
        fireEvent.press(screen.getByText("I've Upgraded"));
      });

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          "Success",
          "You now have Premium access!"
        );
      });
    });

    it("should show not yet alert when premium is still not active", async () => {
      // Initial check returns no premium
      mockApiClient.getUserPremium.mockResolvedValueOnce({
        premium_access: false,
      });

      render(<PremiumRequiredBanner palette={defaultPalette} />);

      await waitFor(() => {
        expect(screen.getByText("I've Upgraded")).toBeTruthy();
      });

      // Still no premium on the "I've Upgraded" check
      mockApiClient.getUserPremium.mockResolvedValueOnce({
        premium_access: false,
      });

      await act(async () => {
        fireEvent.press(screen.getByText("I've Upgraded"));
      });

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          "Not Yet",
          "Your account doesn't have Premium access yet. Please complete your upgrade and try again."
        );
      });
    });
  });

  describe("signed in with premium state", () => {
    beforeEach(() => {
      mockUseCydAccount.mockReturnValue({
        state: {
          isSignedIn: true,
          userEmail: "test@example.com",
          isLoading: false,
        },
        apiClient: mockApiClient,
        getDashboardURL: mockGetDashboardURL,
      });
      mockApiClient.getUserPremium.mockResolvedValue({
        premium_access: true,
        has_individual_subscription: true,
      });
    });

    it("should render nothing when user has premium access", async () => {
      render(<PremiumRequiredBanner palette={defaultPalette} />);

      await waitFor(() => {
        // Component should render null when user has premium - no banner elements should be present
        expect(screen.queryByText("Sign In")).toBeNull();
        expect(screen.queryByText("Manage My Account")).toBeNull();
        expect(screen.queryByText("I've Upgraded")).toBeNull();
        expect(screen.queryByTestId("cyd-avatar")).toBeNull();
      });
    });
  });

  describe("error handling", () => {
    beforeEach(() => {
      mockUseCydAccount.mockReturnValue({
        state: {
          isSignedIn: true,
          userEmail: "test@example.com",
          isLoading: false,
        },
        apiClient: mockApiClient,
        getDashboardURL: mockGetDashboardURL,
      });
    });

    it("should handle API error when checking premium", async () => {
      mockApiClient.getUserPremium.mockResolvedValue({
        error: true,
        message: "Server error",
      });

      render(<PremiumRequiredBanner palette={defaultPalette} />);

      // Should show upgrade prompt (treating error as no premium)
      await waitFor(() => {
        expect(screen.getByText("Manage My Account")).toBeTruthy();
      });
    });

    it("should handle network error when checking premium", async () => {
      mockApiClient.getUserPremium.mockRejectedValue(
        new Error("Network error")
      );

      render(<PremiumRequiredBanner palette={defaultPalette} />);

      // Should show upgrade prompt (treating error as no premium)
      await waitFor(() => {
        expect(screen.getByText("Manage My Account")).toBeTruthy();
      });
    });

    it("should show error alert when I've Upgraded check fails", async () => {
      // Initial check returns no premium
      mockApiClient.getUserPremium.mockResolvedValueOnce({
        premium_access: false,
      });

      render(<PremiumRequiredBanner palette={defaultPalette} />);

      await waitFor(() => {
        expect(screen.getByText("I've Upgraded")).toBeTruthy();
      });

      // Now mock API error for the "I've Upgraded" check
      mockApiClient.getUserPremium.mockResolvedValueOnce({
        error: true,
        message: "Server error",
      });

      await act(async () => {
        fireEvent.press(screen.getByText("I've Upgraded"));
      });

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          "Error",
          "Could not check your account status. Please try again."
        );
      });
    });
  });

  describe("styling", () => {
    it("should apply palette colors to banner", () => {
      render(<PremiumRequiredBanner palette={defaultPalette} />);

      // The banner should render with styled components
      expect(screen.getByText("Sign In")).toBeTruthy();
    });

    it("should render CydAvatar with correct size", () => {
      render(<PremiumRequiredBanner palette={defaultPalette} />);

      expect(screen.getByTestId("cyd-avatar")).toBeTruthy();
      expect(screen.getByText("Avatar 100")).toBeTruthy();
    });
  });
});

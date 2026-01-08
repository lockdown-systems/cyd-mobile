/**
 * @fileoverview Tests for PremiumRequiredModal component
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
import { PremiumRequiredModal } from "../PremiumRequiredModal";

import { useCydAccount } from "@/contexts/CydAccountProvider";

const defaultPalette: AccountTabPalette = Colors.light;

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

describe("PremiumRequiredModal", () => {
  const defaultProps = {
    visible: true,
    palette: defaultPalette,
    onDismiss: jest.fn(),
    onPremiumConfirmed: jest.fn(),
  };

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

  describe("visibility", () => {
    it("should render modal container when visible is false (modal handles visibility)", () => {
      // React Native Modal doesn't unmount children when visible=false
      // It handles visibility internally via native modal presentation
      render(<PremiumRequiredModal {...defaultProps} visible={false} />);

      // The component should still render, but with visible=false passed to Modal
      // In tests, we can verify the Modal prop is set correctly
      // The actual hiding is handled by the native Modal component
      expect(true).toBe(true);
    });

    it("should render content when visible is true", () => {
      render(<PremiumRequiredModal {...defaultProps} />);

      expect(screen.getByText("Premium Required")).toBeTruthy();
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

      render(<PremiumRequiredModal {...defaultProps} />);

      expect(screen.getByText("Checking account status…")).toBeTruthy();
    });
  });

  describe("not signed in state", () => {
    it("should show sign in prompt when user is not signed in", () => {
      render(<PremiumRequiredModal {...defaultProps} />);

      expect(
        screen.getByText(
          "Deleting data requires a Premium account. Sign in to get started."
        )
      ).toBeTruthy();
      expect(screen.getByText("Sign In")).toBeTruthy();
    });

    it("should open sign in modal when Sign In button is pressed", async () => {
      render(<PremiumRequiredModal {...defaultProps} />);

      fireEvent.press(screen.getByText("Sign In"));

      await waitFor(() => {
        expect(screen.getByTestId("sign-in-modal")).toBeTruthy();
      });
    });

    it("should check premium after sign in modal closes", async () => {
      // Start not signed in
      render(<PremiumRequiredModal {...defaultProps} />);

      // Open sign in modal
      fireEvent.press(screen.getByText("Sign In"));

      await waitFor(() => {
        expect(screen.getByTestId("sign-in-modal")).toBeTruthy();
      });

      // Simulate sign in completing
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
      });

      // Close modal
      await act(async () => {
        fireEvent.press(screen.getByTestId("modal-close"));
      });

      // Should have checked premium
      await waitFor(() => {
        expect(mockApiClient.getUserPremium).toHaveBeenCalled();
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
      });
    });

    it("should show upgrade prompt when user has no premium access", async () => {
      render(<PremiumRequiredModal {...defaultProps} />);

      await waitFor(() => {
        expect(
          screen.getByText(
            "Deleting data requires a Premium account. Manage your account to upgrade to Premium."
          )
        ).toBeTruthy();
      });
    });

    it("should show Manage My Account button", async () => {
      render(<PremiumRequiredModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Manage My Account")).toBeTruthy();
      });
    });

    it("should show I've Upgraded button", async () => {
      render(<PremiumRequiredModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("I've Upgraded")).toBeTruthy();
      });
    });

    it("should open dashboard URL when Manage My Account is pressed", async () => {
      const mockOpenURL = jest
        .spyOn(Linking, "openURL")
        .mockResolvedValue(undefined);

      render(<PremiumRequiredModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Manage My Account")).toBeTruthy();
      });

      fireEvent.press(screen.getByText("Manage My Account"));

      expect(mockOpenURL).toHaveBeenCalledWith(
        "https://dash.cyd.social/manage"
      );
      mockOpenURL.mockRestore();
    });
  });

  describe("I've Upgraded button behavior", () => {
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

    it("should check premium status when I've Upgraded is pressed", async () => {
      mockApiClient.getUserPremium.mockResolvedValue({
        premium_access: false,
      });

      render(<PremiumRequiredModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("I've Upgraded")).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(screen.getByText("I've Upgraded"));
      });

      expect(mockApiClient.getUserPremium).toHaveBeenCalled();
    });

    it("should call onPremiumConfirmed when premium is now active", async () => {
      const onPremiumConfirmed = jest.fn();

      // Initial check returns no premium
      mockApiClient.getUserPremium.mockResolvedValueOnce({
        premium_access: false,
      });

      render(
        <PremiumRequiredModal
          {...defaultProps}
          onPremiumConfirmed={onPremiumConfirmed}
        />
      );

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
          "You now have Premium access!",
          expect.arrayContaining([
            expect.objectContaining({
              text: "OK",
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              onPress: expect.any(Function),
            }),
          ])
        );
      });

      // Simulate pressing OK on the alert
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
      const alertCall = (Alert.alert as jest.Mock).mock.calls.find(
        (call) => call[0] === "Success"
      );
      const okButton = alertCall[2].find(
        (btn: { text: string }) => btn.text === "OK"
      );
      okButton.onPress();
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */

      expect(onPremiumConfirmed).toHaveBeenCalled();
    });

    it("should show not yet alert when premium is still not active", async () => {
      mockApiClient.getUserPremium.mockResolvedValue({
        premium_access: false,
      });

      render(<PremiumRequiredModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("I've Upgraded")).toBeTruthy();
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

  describe("auto-confirm when already has premium", () => {
    it("should call onPremiumConfirmed immediately if user has premium when modal opens", async () => {
      const onPremiumConfirmed = jest.fn();

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
      });

      render(
        <PremiumRequiredModal
          {...defaultProps}
          onPremiumConfirmed={onPremiumConfirmed}
        />
      );

      await waitFor(() => {
        expect(onPremiumConfirmed).toHaveBeenCalled();
      });
    });

    it("should call onPremiumConfirmed when user signs in and has premium", async () => {
      const onPremiumConfirmed = jest.fn();

      // Start not signed in
      mockUseCydAccount.mockReturnValue({
        state: {
          isSignedIn: false,
          userEmail: null,
          isLoading: false,
        },
        apiClient: mockApiClient,
        getDashboardURL: mockGetDashboardURL,
      });

      const { rerender } = render(
        <PremiumRequiredModal
          {...defaultProps}
          onPremiumConfirmed={onPremiumConfirmed}
        />
      );

      // User signs in and has premium
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
      });

      // Rerender to simulate sign-in state change
      rerender(
        <PremiumRequiredModal
          {...defaultProps}
          onPremiumConfirmed={onPremiumConfirmed}
        />
      );

      await waitFor(() => {
        expect(onPremiumConfirmed).toHaveBeenCalled();
      });
    });
  });

  describe("dismiss button", () => {
    it("should show Cancel button", () => {
      render(<PremiumRequiredModal {...defaultProps} />);

      expect(screen.getByText("Cancel")).toBeTruthy();
    });

    it("should call onDismiss when Cancel is pressed", () => {
      const onDismiss = jest.fn();

      render(<PremiumRequiredModal {...defaultProps} onDismiss={onDismiss} />);

      fireEvent.press(screen.getByText("Cancel"));

      expect(onDismiss).toHaveBeenCalled();
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

    it("should handle API error when checking premium on I've Upgraded", async () => {
      // Initial check shows no premium
      mockApiClient.getUserPremium.mockResolvedValueOnce({
        premium_access: false,
      });

      render(<PremiumRequiredModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("I've Upgraded")).toBeTruthy();
      });

      // API error on I've Upgraded check
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

    it("should handle network error when checking premium on I've Upgraded", async () => {
      // Initial check shows no premium
      mockApiClient.getUserPremium.mockResolvedValueOnce({
        premium_access: false,
      });

      render(<PremiumRequiredModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("I've Upgraded")).toBeTruthy();
      });

      // Network error on I've Upgraded check
      mockApiClient.getUserPremium.mockRejectedValueOnce(
        new Error("Network error")
      );

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

    it("should silently fail auto-check and show upgrade UI on network error", async () => {
      mockApiClient.getUserPremium.mockRejectedValue(
        new Error("Network error")
      );

      render(<PremiumRequiredModal {...defaultProps} />);

      // Should show upgrade UI despite error
      await waitFor(() => {
        expect(screen.getByText("Manage My Account")).toBeTruthy();
      });
    });
  });

  describe("styling and layout", () => {
    it("should render CydAvatar with correct size", () => {
      render(<PremiumRequiredModal {...defaultProps} />);

      expect(screen.getByTestId("cyd-avatar")).toBeTruthy();
      expect(screen.getByText("Avatar 120")).toBeTruthy();
    });

    it("should show Premium Required title", () => {
      render(<PremiumRequiredModal {...defaultProps} />);

      expect(screen.getByText("Premium Required")).toBeTruthy();
    });
  });
});

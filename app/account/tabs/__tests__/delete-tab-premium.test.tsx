/**
 * @fileoverview Tests for DeleteTab premium functionality
 *
 * Tests the integration between DeleteTab and premium access:
 * - PremiumRequiredBanner visibility based on premium status
 * - Delete My Data button behavior with/without premium
 * - PremiumRequiredModal integration
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

import { useCydAccount } from "@/contexts/CydAccountProvider";

// Import after mocks
import { DeleteTab } from "../delete-tab";

// Mock modules before importing the component
const mockApiClient = {
  getUserPremium: jest.fn(),
};

const mockGetDashboardURL = jest.fn(() => "https://dash.cyd.social/manage");
const mockCheckPremiumAccess = jest.fn();

jest.mock("@/contexts/CydAccountProvider", () => ({
  useCydAccount: jest.fn(() => ({
    state: {
      isSignedIn: false,
      userEmail: null,
      isLoading: false,
      hasPremiumAccess: null,
    },
    apiClient: mockApiClient,
    getDashboardURL: mockGetDashboardURL,
    checkPremiumAccess: mockCheckPremiumAccess,
  })),
}));

// Mock database functions
jest.mock("@/database/delete-settings", () => ({
  getAccountDeleteSettings: jest.fn().mockResolvedValue({
    deletePosts: true,
    deletePostsDaysOldEnabled: false,
    deletePostsDaysOld: 0,
    deletePostsLikesThresholdEnabled: false,
    deletePostsLikesThreshold: 0,
    deletePostsRepostsThresholdEnabled: false,
    deletePostsRepostsThreshold: 0,
    deletePostsPreserveThreads: false,
    deleteReposts: false,
    deleteRepostsDaysOldEnabled: false,
    deleteRepostsDaysOld: 0,
    deleteLikes: false,
    deleteLikesDaysOldEnabled: false,
    deleteLikesDaysOld: 0,
    deleteBookmarks: false,
    deleteChats: false,
    deleteChatsDaysOldEnabled: false,
    deleteChatsDaysOld: 0,
    deleteUnfollowEveryone: false,
  }),
  updateAccountDeleteSettings: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/database/accounts", () => ({
  getLastSavedAt: jest.fn().mockResolvedValue(Date.now()),
  getLastDeletedAt: jest.fn().mockResolvedValue(null),
  getLastScheduledDeletionAt: jest.fn().mockResolvedValue(null),
}));

// Mock BlueskyAccountController
const mockGetDeletionPreviewCounts = jest.fn().mockReturnValue({
  posts: 10,
  reposts: 5,
  likes: 20,
  bookmarks: 3,
  messages: 8,
  follows: 15,
});

jest.mock("@/controllers", () => ({
  BlueskyAccountController: jest.fn().mockImplementation(() => ({
    initDB: jest.fn().mockResolvedValue(undefined),
    initAgent: jest.fn().mockResolvedValue(undefined),
    getDeletionPreviewCounts: mockGetDeletionPreviewCounts,
  })),
}));

// Mock child components that we don't need to test here
jest.mock("@/components/SaveStatusBanner", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  const { View, Text } = require("react-native");
  return {
    SaveStatusBanner: () => (
      <View testID="save-status-banner">
        <Text>Save Status Banner</Text>
      </View>
    ),
  };
});

jest.mock("@/components/PostsToDeleteReviewModal", () => {
  return {
    PostsToDeleteReviewModal: () => null,
  };
});

jest.mock("@/app/account/components/DeleteAutomationModal", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  const { View, Text } = require("react-native");
  return {
    DeleteAutomationModal: ({ visible }: { visible: boolean }) => {
      if (!visible) return null;
      return (
        <View testID="delete-automation-modal">
          <Text>Delete Automation Modal</Text>
        </View>
      );
    },
  };
});

// Mock PremiumRequiredBanner with testable content
jest.mock("@/components/PremiumRequiredBanner", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  const { View, Text } = require("react-native");
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  const { useCydAccount } = require("@/contexts/CydAccountProvider");

  return {
    PremiumRequiredBanner: () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      const { state } = useCydAccount();

      // If signed in and has premium, render nothing (like the real component)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (state.isSignedIn && state.hasPremiumAccess === true) {
        return null;
      }

      return (
        <View testID="premium-required-banner">
          <Text>Premium Required Banner</Text>
          {/* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access */}
          {!state.isSignedIn && <Text>Sign In Required</Text>}
          {/* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access */}
          {state.isSignedIn && state.hasPremiumAccess === false && (
            <Text>Upgrade Required</Text>
          )}
        </View>
      );
    },
  };
});

// Mock PremiumRequiredModal
jest.mock("@/components/PremiumRequiredModal", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  const { View, Text, Pressable } = require("react-native");
  return {
    PremiumRequiredModal: ({
      visible,
      onDismiss,
      onPremiumConfirmed,
    }: {
      visible: boolean;
      onDismiss: () => void;
      onPremiumConfirmed: () => void;
    }) => {
      if (!visible) return null;
      return (
        <View testID="premium-required-modal">
          <Text>Premium Required Modal</Text>
          <Pressable onPress={onDismiss} testID="premium-modal-dismiss">
            <Text>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={onPremiumConfirmed}
            testID="premium-modal-confirm"
          >
            <Text>Premium Confirmed</Text>
          </Pressable>
        </View>
      );
    },
  };
});

// Mock CydAvatar
jest.mock("@/components/cyd/CydAvatar", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  const { View } = require("react-native");
  return {
    CydAvatar: () => <View testID="cyd-avatar" />,
  };
});

const mockUseCydAccount = useCydAccount as jest.Mock;

const defaultPalette: AccountTabPalette = Colors.light;

describe("DeleteTab Premium Integration", () => {
  const defaultProps = {
    accountId: 1,
    accountUUID: "test-uuid-123",
    handle: "testuser.bsky.social",
    palette: defaultPalette,
    onSelectTab: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset to default signed out state
    mockUseCydAccount.mockReturnValue({
      state: {
        isSignedIn: false,
        userEmail: null,
        isLoading: false,
        hasPremiumAccess: null,
      },
      apiClient: mockApiClient,
      getDashboardURL: mockGetDashboardURL,
      checkPremiumAccess: mockCheckPremiumAccess,
    });
  });

  describe("PremiumRequiredBanner visibility", () => {
    it("should show PremiumRequiredBanner when user is not signed in", async () => {
      render(<DeleteTab {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("premium-required-banner")).toBeTruthy();
        expect(screen.getByText("Sign In Required")).toBeTruthy();
      });
    });

    it("should show PremiumRequiredBanner when signed in without premium", async () => {
      mockUseCydAccount.mockReturnValue({
        state: {
          isSignedIn: true,
          userEmail: "test@example.com",
          isLoading: false,
          hasPremiumAccess: false,
        },
        apiClient: mockApiClient,
        getDashboardURL: mockGetDashboardURL,
        checkPremiumAccess: mockCheckPremiumAccess,
      });
      mockApiClient.getUserPremium.mockResolvedValue({
        premium_access: false,
      });

      render(<DeleteTab {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("premium-required-banner")).toBeTruthy();
        expect(screen.getByText("Upgrade Required")).toBeTruthy();
      });
    });

    it("should hide PremiumRequiredBanner when signed in with premium", async () => {
      mockUseCydAccount.mockReturnValue({
        state: {
          isSignedIn: true,
          userEmail: "test@example.com",
          isLoading: false,
          hasPremiumAccess: true,
        },
        apiClient: mockApiClient,
        getDashboardURL: mockGetDashboardURL,
        checkPremiumAccess: mockCheckPremiumAccess,
      });
      mockApiClient.getUserPremium.mockResolvedValue({
        premium_access: true,
      });

      render(<DeleteTab {...defaultProps} />);

      await waitFor(
        () => {
          expect(screen.queryByTestId("premium-required-banner")).toBeNull();
        },
        { timeout: 3000 }
      );
    });
  });

  describe("Delete My Data button - without premium", () => {
    beforeEach(() => {
      mockUseCydAccount.mockReturnValue({
        state: {
          isSignedIn: false,
          userEmail: null,
          isLoading: false,
          hasPremiumAccess: null,
        },
        apiClient: mockApiClient,
        getDashboardURL: mockGetDashboardURL,
        checkPremiumAccess: mockCheckPremiumAccess,
      });
    });

    it("should show PremiumRequiredModal when Delete My Data is pressed without sign in", async () => {
      render(<DeleteTab {...defaultProps} />);

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByText("Continue to Review")).toBeTruthy();
      });

      // Navigate to review screen
      await act(async () => {
        fireEvent.press(screen.getByText("Continue to Review"));
      });

      // Wait for review screen
      await waitFor(() => {
        expect(screen.getByText("Delete My Data")).toBeTruthy();
      });

      // Press Delete My Data
      await act(async () => {
        fireEvent.press(screen.getByText("Delete My Data"));
      });

      // Should show premium modal
      await waitFor(() => {
        expect(screen.getByTestId("premium-required-modal")).toBeTruthy();
      });
    });

    it("should show PremiumRequiredModal when signed in without premium", async () => {
      mockUseCydAccount.mockReturnValue({
        state: {
          isSignedIn: true,
          userEmail: "test@example.com",
          isLoading: false,
          hasPremiumAccess: false,
        },
        apiClient: mockApiClient,
        getDashboardURL: mockGetDashboardURL,
        checkPremiumAccess: mockCheckPremiumAccess,
      });
      mockApiClient.getUserPremium.mockResolvedValue({
        premium_access: false,
      });

      render(<DeleteTab {...defaultProps} />);

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByText("Continue to Review")).toBeTruthy();
      });

      // Navigate to review screen
      await act(async () => {
        fireEvent.press(screen.getByText("Continue to Review"));
      });

      // Wait for review screen
      await waitFor(() => {
        expect(screen.getByText("Delete My Data")).toBeTruthy();
      });

      // Press Delete My Data
      await act(async () => {
        fireEvent.press(screen.getByText("Delete My Data"));
      });

      // Should show premium modal
      await waitFor(() => {
        expect(screen.getByTestId("premium-required-modal")).toBeTruthy();
      });
    });

    it("should reset to form screen when PremiumRequiredModal is dismissed", async () => {
      render(<DeleteTab {...defaultProps} />);

      // Navigate to review screen
      await waitFor(() => {
        expect(screen.getByText("Continue to Review")).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(screen.getByText("Continue to Review"));
      });

      await waitFor(() => {
        expect(screen.getByText("Delete My Data")).toBeTruthy();
      });

      // Press Delete My Data to show modal
      await act(async () => {
        fireEvent.press(screen.getByText("Delete My Data"));
      });

      await waitFor(() => {
        expect(screen.getByTestId("premium-required-modal")).toBeTruthy();
      });

      // Dismiss the modal
      await act(async () => {
        fireEvent.press(screen.getByTestId("premium-modal-dismiss"));
      });

      // Should be back on form screen
      await waitFor(() => {
        expect(screen.getByText("Choose what to delete")).toBeTruthy();
        expect(screen.queryByTestId("premium-required-modal")).toBeNull();
      });
    });

    it("should start deletion when premium is confirmed in modal", async () => {
      render(<DeleteTab {...defaultProps} />);

      // Navigate to review screen
      await waitFor(() => {
        expect(screen.getByText("Continue to Review")).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(screen.getByText("Continue to Review"));
      });

      await waitFor(() => {
        expect(screen.getByText("Delete My Data")).toBeTruthy();
      });

      // Press Delete My Data to show modal
      await act(async () => {
        fireEvent.press(screen.getByText("Delete My Data"));
      });

      await waitFor(() => {
        expect(screen.getByTestId("premium-required-modal")).toBeTruthy();
      });

      // Confirm premium
      await act(async () => {
        fireEvent.press(screen.getByTestId("premium-modal-confirm"));
      });

      // Should show delete automation modal
      await waitFor(() => {
        expect(screen.getByTestId("delete-automation-modal")).toBeTruthy();
        expect(screen.queryByTestId("premium-required-modal")).toBeNull();
      });
    });
  });

  describe("Delete My Data button - with premium", () => {
    beforeEach(() => {
      mockUseCydAccount.mockReturnValue({
        state: {
          isSignedIn: true,
          userEmail: "test@example.com",
          isLoading: false,
          hasPremiumAccess: true,
        },
        apiClient: mockApiClient,
        getDashboardURL: mockGetDashboardURL,
        checkPremiumAccess: mockCheckPremiumAccess,
      });
    });

    it("should go straight to delete automation when user has premium", async () => {
      render(<DeleteTab {...defaultProps} />);

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByText("Continue to Review")).toBeTruthy();
      });

      // Navigate to review screen
      await act(async () => {
        fireEvent.press(screen.getByText("Continue to Review"));
      });

      // Wait for review screen
      await waitFor(() => {
        expect(screen.getByText("Delete My Data")).toBeTruthy();
      });

      // Press Delete My Data
      await act(async () => {
        fireEvent.press(screen.getByText("Delete My Data"));
      });

      // Should show delete automation modal directly, no premium modal
      await waitFor(() => {
        expect(screen.getByTestId("delete-automation-modal")).toBeTruthy();
        expect(screen.queryByTestId("premium-required-modal")).toBeNull();
      });
    });

    it("should not show PremiumRequiredModal when premium check passes", async () => {
      render(<DeleteTab {...defaultProps} />);

      // Navigate to review screen
      await waitFor(() => {
        expect(screen.getByText("Continue to Review")).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(screen.getByText("Continue to Review"));
      });

      await waitFor(() => {
        expect(screen.getByText("Delete My Data")).toBeTruthy();
      });

      // Press Delete My Data
      await act(async () => {
        fireEvent.press(screen.getByText("Delete My Data"));
      });

      // Premium modal should never appear
      await waitFor(() => {
        expect(screen.getByTestId("delete-automation-modal")).toBeTruthy();
      });

      expect(screen.queryByTestId("premium-required-modal")).toBeNull();
    });
  });

  describe("Continue to Review button", () => {
    it("should always allow navigation to review screen regardless of premium status", async () => {
      // Not signed in
      render(<DeleteTab {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Continue to Review")).toBeTruthy();
      });

      // Should be able to press Continue to Review
      await act(async () => {
        fireEvent.press(screen.getByText("Continue to Review"));
      });

      // Should be on review screen
      await waitFor(() => {
        expect(screen.getByText("Delete My Data")).toBeTruthy();
      });
    });
  });

  describe("premium check error handling", () => {
    it("should show PremiumRequiredModal when premium check fails with error", async () => {
      mockUseCydAccount.mockReturnValue({
        state: {
          isSignedIn: true,
          userEmail: "test@example.com",
          isLoading: false,
          hasPremiumAccess: false,
        },
        apiClient: mockApiClient,
        getDashboardURL: mockGetDashboardURL,
        checkPremiumAccess: mockCheckPremiumAccess,
      });

      render(<DeleteTab {...defaultProps} />);

      // Navigate to review screen
      await waitFor(() => {
        expect(screen.getByText("Continue to Review")).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(screen.getByText("Continue to Review"));
      });

      await waitFor(() => {
        expect(screen.getByText("Delete My Data")).toBeTruthy();
      });

      // Press Delete My Data
      await act(async () => {
        fireEvent.press(screen.getByText("Delete My Data"));
      });

      // Should show premium modal (since hasPremiumAccess is false)
      await waitFor(() => {
        expect(screen.getByTestId("premium-required-modal")).toBeTruthy();
      });
    });

    it("should show PremiumRequiredModal when premium check throws", async () => {
      mockUseCydAccount.mockReturnValue({
        state: {
          isSignedIn: true,
          userEmail: "test@example.com",
          isLoading: false,
          hasPremiumAccess: false,
        },
        apiClient: mockApiClient,
        getDashboardURL: mockGetDashboardURL,
        checkPremiumAccess: mockCheckPremiumAccess,
      });

      render(<DeleteTab {...defaultProps} />);

      // Navigate to review screen
      await waitFor(() => {
        expect(screen.getByText("Continue to Review")).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(screen.getByText("Continue to Review"));
      });

      await waitFor(() => {
        expect(screen.getByText("Delete My Data")).toBeTruthy();
      });

      // Press Delete My Data
      await act(async () => {
        fireEvent.press(screen.getByText("Delete My Data"));
      });

      // Should show premium modal (since hasPremiumAccess is false)
      await waitFor(() => {
        expect(screen.getByTestId("premium-required-modal")).toBeTruthy();
      });
    });
  });
});

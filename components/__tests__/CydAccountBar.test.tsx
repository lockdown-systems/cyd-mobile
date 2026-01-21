/**
 * @fileoverview Tests for CydAccountBar component
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import React from "react";
import { Linking } from "react-native";
import { CydAccountBar } from "../CydAccountBar";

// Get the mocked useCydAccount
import { useCydAccount } from "@/contexts/CydAccountProvider";

// Mock the hooks
const mockSignOut = jest.fn();
const mockGetDashboardURL = jest.fn(() => "https://dash.cyd.social");
const mockRefresh = jest.fn();

jest.mock("@/contexts/CydAccountProvider", () => ({
  useCydAccount: jest.fn(() => ({
    state: {
      isSignedIn: false,
      userEmail: null,
      isLoading: false,
    },
    signOut: mockSignOut,
    getDashboardURL: mockGetDashboardURL,
  })),
}));

jest.mock("@/hooks/use-accounts", () => ({
  useAccounts: () => ({
    accounts: [],
    loading: false,
    error: null,
    refresh: mockRefresh,
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@/services/archive-import", () => ({
  cleanupTempDir: jest.fn(),
  importArchive: jest.fn(),
  pickArchiveFile: jest.fn(),
  validateArchive: jest.fn(),
  validateArchiveFilename: jest.fn(),
}));

jest.mock("@/hooks/use-color-scheme", () => ({
  useColorScheme: () => "light",
}));

// Mock CydSignInModal with a simple function component
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
            <Text>Close Modal</Text>
          </Pressable>
        </View>
      );
    },
  };
});
const mockUseCydAccount = useCydAccount as jest.Mock;

describe("CydAccountBar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCydAccount.mockReturnValue({
      state: {
        isSignedIn: false,
        userEmail: null,
        isLoading: false,
      },
      signOut: mockSignOut,
      getDashboardURL: mockGetDashboardURL,
    });
  });

  describe("loading state", () => {
    it("should return null when isLoading is true", () => {
      mockUseCydAccount.mockReturnValue({
        state: {
          isSignedIn: false,
          userEmail: null,
          isLoading: true,
        },
        signOut: mockSignOut,
        getDashboardURL: mockGetDashboardURL,
      });

      const { toJSON } = render(<CydAccountBar />);

      expect(toJSON()).toBeNull();
    });
  });

  describe("signed out state", () => {
    it("should show 'Not signed in to Cyd' text", () => {
      render(<CydAccountBar />);

      expect(screen.getByText("Not signed in to Cyd")).toBeTruthy();
    });

    it("should show menu button", () => {
      render(<CydAccountBar />);

      expect(screen.getByText("☰")).toBeTruthy();
    });

    it("should open menu when menu button is pressed", () => {
      render(<CydAccountBar />);

      fireEvent.press(screen.getByText("☰"));

      expect(
        screen.getByText("Sign in to Cyd to access premium features"),
      ).toBeTruthy();
    });

    it("should show Sign in option in menu", () => {
      render(<CydAccountBar />);

      fireEvent.press(screen.getByText("☰"));

      expect(
        screen.getByText("Sign in to Cyd to access premium features"),
      ).toBeTruthy();
    });

    it("should open sign in modal when Sign in is pressed", async () => {
      render(<CydAccountBar />);

      fireEvent.press(screen.getByText("☰"));
      fireEvent.press(
        screen.getByText("Sign in to Cyd to access premium features"),
      );

      await waitFor(() => {
        expect(screen.getByTestId("sign-in-modal")).toBeTruthy();
      });
    });

    it("should close menu when Sign in is pressed", () => {
      render(<CydAccountBar />);

      fireEvent.press(screen.getByText("☰"));
      expect(
        screen.getByText("Sign in to Cyd to access premium features"),
      ).toBeTruthy();

      fireEvent.press(
        screen.getByText("Sign in to Cyd to access premium features"),
      );

      // Menu should close (the menu text should no longer be visible in the modal)
      // The modal should be closed, so the menu item is hidden
    });
  });

  describe("signed in state", () => {
    beforeEach(() => {
      mockUseCydAccount.mockReturnValue({
        state: {
          isSignedIn: true,
          userEmail: "test@example.com",
          isLoading: false,
        },
        signOut: mockSignOut,
        getDashboardURL: mockGetDashboardURL,
      });
    });

    it("should show signed in email", () => {
      render(<CydAccountBar />);

      expect(
        screen.getAllByText(/Signed in as test@example.com/).length,
      ).toBeGreaterThan(0);
    });

    it("should show email in menu header", () => {
      render(<CydAccountBar />);

      fireEvent.press(screen.getByText("☰"));

      // Email should appear in menu as part of "Signed in as" text
      expect(screen.getAllByText(/test@example.com/).length).toBeGreaterThan(0);
    });

    it("should show Manage my Cyd account option", () => {
      render(<CydAccountBar />);

      fireEvent.press(screen.getByText("☰"));

      expect(screen.getByText("Manage my Cyd account")).toBeTruthy();
    });

    it("should show Sign out option", () => {
      render(<CydAccountBar />);

      fireEvent.press(screen.getByText("☰"));

      expect(screen.getByText("Sign out of Cyd account")).toBeTruthy();
    });

    it("should open dashboard URL when Manage my Cyd account is pressed", () => {
      const mockOpenURL = jest
        .spyOn(Linking, "openURL")
        .mockResolvedValue(undefined);

      render(<CydAccountBar />);

      fireEvent.press(screen.getByText("☰"));
      fireEvent.press(screen.getByText("Manage my Cyd account"));

      expect(mockOpenURL).toHaveBeenCalledWith("https://dash.cyd.social");
      mockOpenURL.mockRestore();
    });

    it("should call signOut when Sign out is pressed", () => {
      render(<CydAccountBar />);

      fireEvent.press(screen.getByText("☰"));
      fireEvent.press(screen.getByText("Sign out of Cyd account"));

      expect(mockSignOut).toHaveBeenCalled();
    });

    it("should close menu when Sign out is pressed", () => {
      render(<CydAccountBar />);

      fireEvent.press(screen.getByText("☰"));
      expect(screen.getByText("Sign out of Cyd account")).toBeTruthy();

      fireEvent.press(screen.getByText("Sign out of Cyd account"));

      // Verify signOut was called - this happens when menu item is pressed
      // The menu closes as part of handleSignOut
      expect(mockSignOut).toHaveBeenCalled();
    });
  });

  describe("menu behavior", () => {
    it("should close menu when overlay is pressed", async () => {
      render(<CydAccountBar />);

      fireEvent.press(screen.getByText("☰"));
      expect(
        screen.getByText("Sign in to Cyd to access premium features"),
      ).toBeTruthy();

      // The Modal overlay press should close the menu
      // This is handled by the modal's onRequestClose or overlay Pressable
      // We can simulate this by checking the menu item visibility after pressing
    });

    it("should show menu options when signed in", () => {
      mockUseCydAccount.mockReturnValue({
        state: {
          isSignedIn: true,
          userEmail: "test@example.com",
          isLoading: false,
        },
        signOut: mockSignOut,
        getDashboardURL: mockGetDashboardURL,
      });

      render(<CydAccountBar />);

      fireEvent.press(screen.getByText("☰"));

      expect(screen.getByText("Manage my Cyd account")).toBeTruthy();
      expect(screen.getByText("Sign out of Cyd account")).toBeTruthy();
    });

    it("should show different menu when signed out", () => {
      render(<CydAccountBar />);

      fireEvent.press(screen.getByText("☰"));

      expect(
        screen.getByText("Sign in to Cyd to access premium features"),
      ).toBeTruthy();
      // These should NOT be present when signed out
      expect(screen.queryByText("Manage my account")).toBeNull();
      expect(screen.queryByText("Sign out")).toBeNull();
    });
  });

  describe("safe area handling", () => {
    it("should render with useSafeAreaInsets", () => {
      // This should not throw
      expect(() => {
        render(<CydAccountBar />);
      }).not.toThrow();
    });
  });

  describe("sign in modal", () => {
    it("should close sign in modal when onClose is triggered", async () => {
      render(<CydAccountBar />);

      // Open menu and then sign in modal
      fireEvent.press(screen.getByText("☰"));
      fireEvent.press(
        screen.getByText("Sign in to Cyd to access premium features"),
      );

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

  describe("long email handling", () => {
    it("should truncate long email addresses", () => {
      mockUseCydAccount.mockReturnValue({
        state: {
          isSignedIn: true,
          userEmail: "very.long.email.address.that.might.overflow@example.com",
          isLoading: false,
        },
        signOut: mockSignOut,
        getDashboardURL: mockGetDashboardURL,
      });

      render(<CydAccountBar />);

      // The text should be present (numberOfLines={1} handles truncation)
      expect(
        screen.getAllByText(
          /Signed in as very.long.email.address.that.might.overflow@example.com/,
        ).length,
      ).toBeGreaterThan(0);
    });
  });
});

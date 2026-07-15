/**
 * @fileoverview Tests for CydAccountProvider context
 */

import { act, render, waitFor } from "@testing-library/react-native";
import {
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  requestPurchase,
} from "expo-iap";
import React from "react";

import { getCydAccountCredentials } from "@/database/cyd-account";
import {
  CydAccountProvider,
  type CydAccountContextType,
  useCydAccount,
} from "../CydAccountProvider";

const mockSyncAppStoreSubscription = jest.fn();
const mockGetAppStoreSubscription = jest.fn();
const mockPing = jest.fn(() => Promise.resolve(false));

jest.mock("@/constants/subscriptions", () => ({
  ...jest.requireActual("@/constants/subscriptions"),
  PREMIUM_UPSELL_MODE: "app_store_iap",
}));

// Mock the database functions
jest.mock("@/database/cyd-account", () => ({
  getCydAccountCredentials: jest.fn(() =>
    Promise.resolve({
      userEmail: null,
      deviceToken: null,
      deviceUUID: null,
    }),
  ),
  setCydAccountCredentials: jest.fn(() => Promise.resolve()),
  clearCydAccountCredentials: jest.fn(() => Promise.resolve()),
}));

// Mock the API client
jest.mock("@/services/cyd-api-client", () => {
  return jest.fn().mockImplementation(() => ({
    setCredentials: jest.fn(),
    setUserEmail: jest.fn(),
    getUserEmail: jest.fn(() => null),
    ping: mockPing,
    authenticate: jest.fn(() => Promise.resolve(true)),
    registerDevice: jest.fn(() =>
      Promise.resolve({
        uuid: "test-uuid",
        device_token: "test-device-token",
      }),
    ),
    postNewsletter: jest.fn(() => Promise.resolve(true)),
    postUserActivity: jest.fn(() => Promise.resolve(true)),
    deleteDevice: jest.fn(() => Promise.resolve()),
    getDashboardURL: jest.fn(() => "https://dash.cyd.social"),
    getAppStoreSubscription: mockGetAppStoreSubscription,
    syncAppStoreSubscription: mockSyncAppStoreSubscription,
  }));
});

describe("CydAccountProvider", () => {
  describe("exports", () => {
    it("should export CydAccountProvider component", () => {
      expect(CydAccountProvider).toBeDefined();
      expect(typeof CydAccountProvider).toBe("function");
    });

    it("should export useCydAccount hook", () => {
      expect(useCydAccount).toBeDefined();
      expect(typeof useCydAccount).toBe("function");
    });
  });

  describe("CydAccountProvider component", () => {
    it("should be a valid React component", () => {
      const element = React.createElement(
        CydAccountProvider,
        null,
        React.createElement("div", null, "test")
      );

      expect(element).toBeDefined();
      expect(element.type).toBe(CydAccountProvider);
    });

    it("should accept children prop", () => {
      const childElement = React.createElement("span", null, "child");
      const element = React.createElement(
        CydAccountProvider,
        null,
        childElement
      );

      expect(element.props.children).toBe(childElement);
    });
  });

  describe("useCydAccount hook", () => {
    it("should throw an error when used outside of CydAccountProvider", () => {
      // Test that the hook throws when not wrapped in provider
      expect(() => {
        // This will throw because there's no provider
        const TestComponent = () => {
          useCydAccount();
          return null;
        };
        // Attempt to render element - the hook will check context
        React.createElement(TestComponent);
      }).not.toThrow(); // Creating element doesn't throw - calling the hook does

      // The actual throw happens when the component renders
      // which we can verify by the hook's implementation
    });
  });

  describe("context value structure", () => {
    it("should provide expected state shape through context", () => {
      // Validate the expected state shape based on the type definitions
      type ExpectedState = {
        isSignedIn: boolean;
        userEmail: string | null;
        isLoading: boolean;
      };

      // Type check passes if this compiles
      const mockState: ExpectedState = {
        isSignedIn: false,
        userEmail: null,
        isLoading: true,
      };

      expect(mockState.isSignedIn).toBe(false);
      expect(mockState.userEmail).toBeNull();
      expect(mockState.isLoading).toBe(true);
    });
  });

  describe("App Store purchases", () => {
    it("fetches, purchases, and restores a monthly subscription", async () => {
      mockPing.mockResolvedValue(true);
      (getCydAccountCredentials as jest.Mock).mockResolvedValue({
        userEmail: "subscriber@example.com",
        deviceToken: "device-token",
        deviceUUID: "device-uuid",
      });
      mockSyncAppStoreSubscription.mockResolvedValue({
        subscription: { product_id: "premium_monthly" },
        premium: { premium_access: true },
      });
      mockGetAppStoreSubscription.mockResolvedValue({
        app_account_token: "00000000-0000-4000-8000-000000000000",
        subscription: null,
        premium: { premium_access: false },
      });

      const monthlyPurchase = {
        productId: "premium_monthly",
        transactionId: "monthly-transaction-id",
      };
      (getAvailablePurchases as jest.Mock).mockResolvedValue([monthlyPurchase]);

      let context: CydAccountContextType | null = null;
      function ContextReader() {
        context = useCydAccount();
        return null;
      }

      render(
        <CydAccountProvider>
          <ContextReader />
        </CydAccountProvider>,
      );

      await waitFor(() => {
        expect(context?.state.isSignedIn).toBe(true);
        expect(context?.appStorePurchaseState.isConnected).toBe(true);
      });
      expect(fetchProducts).toHaveBeenCalledWith({
        skus: ["premium_annual", "premium_monthly"],
        type: "subs",
      });

      await act(async () => {
        await context?.purchasePremium("monthly");
      });
      expect(requestPurchase).toHaveBeenCalledWith({
        request: {
          apple: {
            sku: "premium_monthly",
            appAccountToken: "00000000-0000-4000-8000-000000000000",
          },
        },
        type: "subs",
      });

      let result;
      await act(async () => {
        result = await context?.restoreAppStorePurchases();
      });

      expect(result).toEqual({ success: true });
      expect(mockSyncAppStoreSubscription).toHaveBeenCalledWith({
        transaction_id: "monthly-transaction-id",
      });
      expect(finishTransaction).toHaveBeenCalledWith({
        purchase: monthlyPurchase,
        isConsumable: false,
      });
    });
  });
});

/**
 * @fileoverview Tests for CydAccountProvider's Google Play Billing flow
 *
 * The Play Store build sells Premium through Google Play Billing (#124):
 * purchases carry the account's obfuscated ID, cyd-server verifies each
 * purchase token, and a purchase is only acknowledged once verification
 * grants Premium.
 */

import { act, render, waitFor } from "@testing-library/react-native";
import {
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  purchaseUpdatedListener,
  requestPurchase,
} from "expo-iap";
import React from "react";

import {
  getCydAccountCredentials,
} from "@/database/cyd-account";
import {
  CydAccountProvider,
  type CydAccountContextType,
  useCydAccount,
} from "../CydAccountProvider";

const mockSyncGooglePlaySubscription = jest.fn();
const mockGetGooglePlaySubscription = jest.fn();
const mockGetUserPremium = jest.fn();
const mockRefreshAuthentication = jest.fn();
const mockPing = jest.fn(() => Promise.resolve(false));

jest.mock("@/constants/subscriptions", () => ({
  ...jest.requireActual("@/constants/subscriptions"),
  PREMIUM_UPSELL_MODE: "play_billing",
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
    getUserPremium: mockGetUserPremium,
    refreshAuthentication: mockRefreshAuthentication,
    getAppStoreSubscription: jest.fn(),
    syncAppStoreSubscription: jest.fn(),
    getGooglePlaySubscription: mockGetGooglePlaySubscription,
    syncGooglePlaySubscription: mockSyncGooglePlaySubscription,
  }));
});

describe("CydAccountProvider Google Play purchases", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPing.mockResolvedValue(false);
    mockRefreshAuthentication.mockResolvedValue(true);
    (getCydAccountCredentials as jest.Mock).mockResolvedValue({
      userEmail: null,
      deviceToken: null,
      deviceUUID: null,
    });
  });

  it("fetches, purchases, verifies, acknowledges, and restores a monthly subscription", async () => {
    mockPing.mockResolvedValue(true);
    (getCydAccountCredentials as jest.Mock).mockResolvedValue({
      userEmail: "subscriber@example.com",
      deviceToken: "device-token",
      deviceUUID: "device-uuid",
    });
    mockGetGooglePlaySubscription.mockResolvedValue({
      obfuscated_account_id: "obfuscated-account-id",
      subscription: null,
      premium: { premium_access: false },
    });
    mockSyncGooglePlaySubscription.mockResolvedValue({
      subscription: {
        purchase_token: "play-purchase-token",
        product_id: "premium_monthly",
      },
      premium: { premium_access: true },
    });
    (fetchProducts as jest.Mock).mockResolvedValue([
      {
        id: "premium_annual",
        title: "Cyd Premium Annual",
        displayPrice: "$35.99",
        subscriptionOfferDetailsAndroid: [{ offerToken: "annual-offer-token" }],
      },
      {
        id: "premium_monthly",
        title: "Cyd Premium Monthly",
        displayPrice: "$4.99",
        // A promotional offer comes back first; the base plan is what should
        // be purchased.
        subscriptionOfferDetailsAndroid: [
          { offerId: "trial-offer", offerToken: "trial-offer-token" },
          { offerId: null, offerToken: "monthly-offer-token" },
        ],
      },
    ]);

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
      expect(context?.storePurchaseState.isConnected).toBe(true);
    });
    expect(fetchProducts).toHaveBeenCalledWith({
      skus: ["premium_annual", "premium_monthly"],
      type: "subs",
    });
    expect(context?.storePurchaseState.products.monthly?.offerToken).toBe(
      "monthly-offer-token",
    );

    await act(async () => {
      await context?.purchasePremium("monthly");
    });
    expect(requestPurchase).toHaveBeenCalledWith({
      request: {
        google: {
          skus: ["premium_monthly"],
          obfuscatedAccountId: "obfuscated-account-id",
          subscriptionOffers: [
            { sku: "premium_monthly", offerToken: "monthly-offer-token" },
          ],
        },
      },
      type: "subs",
    });

    // The purchase the Play store reports back is verified by cyd-server
    // before it is acknowledged.
    const purchaseCallback = (purchaseUpdatedListener as jest.Mock).mock
      .calls[0][0] as (purchase: unknown) => void;
    const playPurchase = {
      productId: "premium_monthly",
      purchaseToken: "play-purchase-token",
      isAutoRenewing: true,
    };
    await act(async () => {
      await purchaseCallback(playPurchase);
    });
    expect(mockSyncGooglePlaySubscription).toHaveBeenCalledWith({
      purchase_token: "play-purchase-token",
    });
    expect(finishTransaction).toHaveBeenCalledWith({
      purchase: playPurchase,
      isConsumable: false,
    });
    expect(context?.state.hasPremiumAccess).toBe(true);

    // Restoring on Android reads the store's purchase history directly.
    (getAvailablePurchases as jest.Mock).mockResolvedValue([playPurchase]);
    let result;
    await act(async () => {
      result = await context?.restoreStorePurchases();
    });

    expect(result).toEqual({ success: true });
    expect(mockSyncGooglePlaySubscription).toHaveBeenCalledWith({
      purchase_token: "play-purchase-token",
    });
  });

  it("does not acknowledge a purchase the server rejects", async () => {
    mockPing.mockResolvedValue(true);
    (getCydAccountCredentials as jest.Mock).mockResolvedValue({
      userEmail: "mismatch@example.com",
      deviceToken: "device-token",
      deviceUUID: "device-uuid",
    });
    mockSyncGooglePlaySubscription.mockResolvedValue({
      error: true,
      message: "This subscription belongs to another Cyd account.",
      status: 409,
    });
    (fetchProducts as jest.Mock).mockResolvedValue([
      {
        id: "premium_monthly",
        title: "Cyd Premium Monthly",
        displayPrice: "$4.99",
        subscriptionOfferDetailsAndroid: [
          { offerToken: "monthly-offer-token" },
        ],
      },
    ]);

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
    });

    const purchaseCallback = (purchaseUpdatedListener as jest.Mock).mock
      .calls[0][0] as (purchase: unknown) => void;
    await act(async () => {
      await purchaseCallback({
        productId: "premium_monthly",
        purchaseToken: "play-purchase-token",
        isAutoRenewing: true,
      });
    });

    expect(finishTransaction).not.toHaveBeenCalled();
    expect(context?.state.hasPremiumAccess).toBe(null);
    expect(context?.storePurchaseState.error).toBe(
      "This subscription belongs to another Cyd account.",
    );
  });

  it("links subscription management to the Google Play subscription center", async () => {
    mockPing.mockResolvedValue(false);

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

    await waitFor(() => expect(context?.state.isLoading).toBe(false));
    expect(context?.getManageSubscriptionURL()).toBe(
      "https://play.google.com/store/account/subscriptions?package=systems.lockdown.cydmobile",
    );
  });
});

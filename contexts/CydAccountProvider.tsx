import {
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  restorePurchases,
  type ProductSubscription,
  type Purchase,
} from "expo-iap";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";

import {
  APP_STORE_SUBSCRIPTION_PLANS,
  APP_STORE_SUBSCRIPTION_PRODUCT_IDS,
  CYD_API_ENV,
  PREMIUM_UPSELL_MODE,
  type BillingPeriod,
  type PremiumUpsellMode,
} from "@/constants/subscriptions";
import {
  clearCydAccountCredentials,
  getCydAccountCredentials,
  setCydAccountCredentials,
} from "@/database/cyd-account";
import CydAPIClient, {
  type SyncAppStoreSubscriptionAPIRequest,
} from "@/services/cyd-api-client";
import { submitBlueskyProgressForAllAccounts } from "@/services/submit-bluesky-progress";

// Configuration for API environments
const PROD_API_URL = "https://api.cyd.social";
const PROD_DASH_URL = "https://dash.cyd.social";
const DEV_API_URL = "https://dev-api.cyd.social";
const DEV_DASH_URL = "https://dev-dash.cyd.social";

const API_URL = CYD_API_ENV === "dev" ? DEV_API_URL : PROD_API_URL;
const DASH_URL = CYD_API_ENV === "dev" ? DEV_DASH_URL : PROD_DASH_URL;

export type CydAccountState = {
  isSignedIn: boolean;
  userEmail: string | null;
  isLoading: boolean;
  hasPremiumAccess: boolean | null;
};

export type AppStoreProductSummary = {
  productId: string;
  title: string;
  displayPrice: string;
};

export type AppStorePurchaseState = {
  products: Record<BillingPeriod, AppStoreProductSummary | null>;
  isConnected: boolean;
  isLoadingProduct: boolean;
  isPurchasing: boolean;
  isRestoring: boolean;
  error: string | null;
};

export type PremiumActionResult = {
  success: boolean;
  error?: string;
};

export type CydAccountContextType = {
  state: CydAccountState;
  apiClient: CydAPIClient;
  premiumUpsellMode: PremiumUpsellMode;
  appStorePurchaseState: AppStorePurchaseState;
  signIn: (
    email: string,
    verificationCode: string,
    subscribeToNewsletter: boolean,
  ) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  sendVerificationCode: (
    email: string,
  ) => Promise<{ success: boolean; error?: string }>;
  refreshState: () => Promise<void>;
  getDashboardURL: () => string;
  checkPremiumAccess: () => Promise<void>;
  purchasePremium: (
    billingPeriod: BillingPeriod,
  ) => Promise<PremiumActionResult>;
  restoreAppStorePurchases: () => Promise<PremiumActionResult>;
};

const CydAccountContext = createContext<CydAccountContextType | null>(null);

export function useCydAccount(): CydAccountContextType {
  const context = useContext(CydAccountContext);
  if (!context) {
    throw new Error("useCydAccount must be used within a CydAccountProvider");
  }
  return context;
}

type CydAccountProviderProps = {
  children: React.ReactNode;
};

export function CydAccountProvider({ children }: CydAccountProviderProps) {
  const [state, setState] = useState<CydAccountState>({
    isSignedIn: false,
    userEmail: null,
    isLoading: true,
    hasPremiumAccess: null,
  });
  const [appStorePurchaseState, setAppStorePurchaseState] =
    useState<AppStorePurchaseState>({
      products: {
        annual: null,
        monthly: null,
      },
      isConnected: false,
      isLoadingProduct: PREMIUM_UPSELL_MODE === "app_store_iap",
      isPurchasing: false,
      isRestoring: false,
      error: null,
    });

  const apiClient = useMemo(() => new CydAPIClient(API_URL, DASH_URL), []);

  const refreshState = useCallback(async () => {
    try {
      const credentials = await getCydAccountCredentials();

      if (credentials.userEmail && credentials.deviceToken) {
        apiClient.setCredentials(
          credentials.userEmail,
          credentials.deviceToken,
        );

        // Verify the session is still valid
        const isValid = await apiClient.ping();

        setState((prev) => ({
          ...prev,
          isSignedIn: isValid,
          userEmail: isValid ? credentials.userEmail : null,
          isLoading: false,
        }));

        if (!isValid) {
          // Clear invalid credentials
          await clearCydAccountCredentials();
        }
      } else {
        setState((prev) => ({
          ...prev,
          isSignedIn: false,
          userEmail: null,
          isLoading: false,
        }));
      }
    } catch (error) {
      console.error("Error refreshing Cyd account state:", error);
      setState((prev) => ({
        ...prev,
        isSignedIn: false,
        userEmail: null,
        isLoading: false,
      }));
    }
  }, [apiClient]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const sendVerificationCode = useCallback(
    async (email: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const response = await apiClient.authenticate({ email });

        if (typeof response === "boolean") {
          if (response) {
            apiClient.setUserEmail(email);
            return { success: true };
          }
          return { success: false, error: "Authentication failed" };
        }

        if (response.error) {
          if (response.status === 403) {
            return {
              success: false,
              error: "Sign-in is restricted for this account",
            };
          }
          return { success: false, error: response.message };
        }

        return { success: true };
      } catch (error) {
        console.error("Error sending verification code:", error);
        return {
          success: false,
          error: "Failed to send verification code. Please try again.",
        };
      }
    },
    [apiClient],
  );

  const signIn = useCallback(
    async (
      email: string,
      verificationCode: string,
      subscribeToNewsletter: boolean,
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        // Get device description
        const deviceDescription = `Cyd Mobile on ${
          Platform.OS === "ios" ? "iOS" : "Android"
        }`;

        // Register the device with the verification code
        const registerResponse = await apiClient.registerDevice({
          email,
          verification_code: verificationCode,
          description: deviceDescription,
          device_type: "mobile",
        });

        if ("error" in registerResponse) {
          return {
            success: false,
            error: "Invalid verification code. Please try again.",
          };
        }

        // Save credentials
        await setCydAccountCredentials({
          userEmail: email,
          deviceToken: registerResponse.device_token,
          deviceUUID: registerResponse.uuid,
        });

        // Set credentials in the API client
        apiClient.setCredentials(email, registerResponse.device_token);

        // Verify we can ping the server
        const pingResult = await apiClient.ping();
        if (!pingResult) {
          return {
            success: false,
            error: "Failed to verify device registration. Please try again.",
          };
        }

        // Subscribe to newsletter if requested
        if (subscribeToNewsletter) {
          try {
            await apiClient.postNewsletter({ email });
          } catch (e) {
            // Silently log and continue
            console.log("Error subscribing to newsletter:", e);
          }
        }

        // Update user activity
        try {
          await apiClient.postUserActivity();
        } catch (e) {
          console.log("Error updating user activity:", e);
        }

        // Submit Bluesky progress for all accounts now that we're authenticated
        // This ensures any previously unauthenticated progress is associated with the user
        try {
          await submitBlueskyProgressForAllAccounts(apiClient);
        } catch (e) {
          console.log("Error submitting Bluesky progress:", e);
        }

        setState({
          isSignedIn: true,
          userEmail: email,
          isLoading: false,
          hasPremiumAccess: null, // Will be checked on next checkPremiumAccess call
        });

        return { success: true };
      } catch (error) {
        console.error("Error signing in:", error);
        return {
          success: false,
          error: "Failed to sign in. Please try again.",
        };
      }
    },
    [apiClient],
  );

  const signOut = useCallback(async () => {
    try {
      // Try to delete the device from the server
      const credentials = await getCydAccountCredentials();
      if (credentials.deviceUUID) {
        try {
          await apiClient.deleteDevice({ uuid: credentials.deviceUUID });
        } catch (e) {
          console.log("Error deleting device from server:", e);
        }
      }

      // Clear local credentials
      await clearCydAccountCredentials();
      apiClient.setCredentials(null, null);

      setState({
        isSignedIn: false,
        userEmail: null,
        isLoading: false,
        hasPremiumAccess: null,
      });
    } catch (error) {
      console.error("Error signing out:", error);
      // Still clear local state even if server call fails
      await clearCydAccountCredentials();
      apiClient.setCredentials(null, null);
      setState({
        isSignedIn: false,
        userEmail: null,
        isLoading: false,
        hasPremiumAccess: null,
      });
    }
  }, [apiClient]);

  const checkPremiumAccess = useCallback(async () => {
    if (!state.isSignedIn) {
      setState((prev) => ({ ...prev, hasPremiumAccess: false }));
      return;
    }
    try {
      const response = await apiClient.getUserPremium();
      if ("error" in response) {
        setState((prev) => ({ ...prev, hasPremiumAccess: false }));
      } else {
        setState((prev) => ({
          ...prev,
          hasPremiumAccess: response.premium_access,
        }));
      }
    } catch {
      setState((prev) => ({ ...prev, hasPremiumAccess: false }));
    }
  }, [state.isSignedIn, apiClient]);

  const syncAppStorePurchase = useCallback(
    async (purchase: Purchase): Promise<boolean> => {
      if (!APP_STORE_SUBSCRIPTION_PRODUCT_IDS.includes(purchase.productId)) {
        return false;
      }

      const syncRequest = getAppStoreSyncRequest(purchase);
      if (!syncRequest) {
        setAppStorePurchaseState((prev) => ({
          ...prev,
          error: "Apple did not return a transaction identifier.",
        }));
        return false;
      }

      const syncResponse =
        await apiClient.syncAppStoreSubscription(syncRequest);
      if ("error" in syncResponse) {
        setAppStorePurchaseState((prev) => ({
          ...prev,
          error: syncResponse.message,
        }));
        return false;
      }

      await finishTransaction({ purchase, isConsumable: false });
      setState((prev) => ({
        ...prev,
        hasPremiumAccess: syncResponse.premium.premium_access,
      }));
      setAppStorePurchaseState((prev) => ({ ...prev, error: null }));
      return true;
    },
    [apiClient],
  );

  useEffect(() => {
    if (PREMIUM_UPSELL_MODE !== "app_store_iap") {
      return;
    }

    let isActive = true;
    const purchaseUpdateSubscription = purchaseUpdatedListener((purchase) => {
      void (async () => {
        try {
          await syncAppStorePurchase(purchase);
        } catch (error) {
          setAppStorePurchaseState((prev) => ({
            ...prev,
            error: getAppStoreErrorMessage(error),
          }));
        } finally {
          setAppStorePurchaseState((prev) => ({
            ...prev,
            isPurchasing: false,
          }));
        }
      })();
    });
    const purchaseErrorSubscription = purchaseErrorListener((error) => {
      setAppStorePurchaseState((prev) => ({
        ...prev,
        isPurchasing: false,
        error: isUserCancelledAppStoreError(error)
          ? null
          : getAppStoreErrorMessage(error),
      }));
    });

    void (async () => {
      try {
        await initConnection();
        const products = (await fetchProducts({
          skus: APP_STORE_SUBSCRIPTION_PRODUCT_IDS,
          type: "subs",
        })) as ProductSubscription[];
        const productsByBillingPeriod = APP_STORE_SUBSCRIPTION_PLANS.reduce<
          Record<BillingPeriod, AppStoreProductSummary | null>
        >(
          (result, plan) => {
            const product = products.find(
              (candidate) => candidate.id === plan.productId,
            );
            result[plan.billingPeriod] = product
              ? summarizeAppStoreProduct(product)
              : null;
            return result;
          },
          { annual: null, monthly: null },
        );
        const hasAvailableProduct = Object.values(
          productsByBillingPeriod,
        ).some(Boolean);
        if (!isActive) {
          return;
        }
        setAppStorePurchaseState((prev) => ({
          ...prev,
          products: productsByBillingPeriod,
          isConnected: true,
          isLoadingProduct: false,
          error: hasAvailableProduct
            ? null
            : "Premium is not available in the App Store yet.",
        }));
      } catch (error) {
        if (!isActive) {
          return;
        }
        setAppStorePurchaseState((prev) => ({
          ...prev,
          isConnected: false,
          isLoadingProduct: false,
          error: getAppStoreErrorMessage(error),
        }));
      }
    })();

    return () => {
      isActive = false;
      purchaseUpdateSubscription.remove();
      purchaseErrorSubscription.remove();
      void endConnection();
    };
  }, [syncAppStorePurchase]);

  const getDashboardURL = useCallback(() => {
    return apiClient.getDashboardURL();
  }, [apiClient]);

  const purchasePremium = useCallback(
    async (billingPeriod: BillingPeriod): Promise<PremiumActionResult> => {
      if (PREMIUM_UPSELL_MODE !== "app_store_iap") {
        return {
          success: false,
          error: "Premium uses account management for this build.",
        };
      }
      if (!state.isSignedIn) {
        return { success: false, error: "Please sign in before subscribing." };
      }

      const plan = APP_STORE_SUBSCRIPTION_PLANS.find(
        (candidate) => candidate.billingPeriod === billingPeriod,
      );
      if (!plan || !appStorePurchaseState.products[billingPeriod]) {
        return {
          success: false,
          error: "That Premium plan is not available in the App Store yet.",
        };
      }

      setAppStorePurchaseState((prev) => ({
        ...prev,
        isPurchasing: true,
        error: null,
      }));

      try {
        if (!appStorePurchaseState.isConnected) {
          await initConnection();
          setAppStorePurchaseState((prev) => ({ ...prev, isConnected: true }));
        }

        const subscriptionMetadata = await apiClient.getAppStoreSubscription();
        if ("error" in subscriptionMetadata) {
          setAppStorePurchaseState((prev) => ({
            ...prev,
            isPurchasing: false,
            error: subscriptionMetadata.message,
          }));
          return { success: false, error: subscriptionMetadata.message };
        }

        await requestPurchase({
          request: {
            apple: {
              sku: plan.productId,
              appAccountToken: subscriptionMetadata.app_account_token,
            },
          },
          type: "subs",
        });
        return { success: true };
      } catch (error) {
        const message = getAppStoreErrorMessage(error);
        setAppStorePurchaseState((prev) => ({
          ...prev,
          isPurchasing: false,
          error: message,
        }));
        return { success: false, error: message };
      }
    },
    [apiClient, appStorePurchaseState, state.isSignedIn],
  );

  const restoreAppStorePurchases =
    useCallback(async (): Promise<PremiumActionResult> => {
      if (PREMIUM_UPSELL_MODE !== "app_store_iap") {
        return {
          success: false,
          error: "Restore purchases is only available in the App Store build.",
        };
      }
      if (!state.isSignedIn) {
        return {
          success: false,
          error: "Please sign in before restoring purchases.",
        };
      }

      setAppStorePurchaseState((prev) => ({
        ...prev,
        isRestoring: true,
        error: null,
      }));

      try {
        if (!appStorePurchaseState.isConnected) {
          await initConnection();
          setAppStorePurchaseState((prev) => ({ ...prev, isConnected: true }));
        }

        await restorePurchases();
        const purchases = await getAvailablePurchases({
          onlyIncludeActiveItemsIOS: true,
        });
        const premiumPurchases = purchases.filter(
          (purchase) =>
            APP_STORE_SUBSCRIPTION_PRODUCT_IDS.includes(purchase.productId),
        );

        if (premiumPurchases.length === 0) {
          const message =
            "No active Premium purchase was found for this Apple ID.";
          setAppStorePurchaseState((prev) => ({ ...prev, error: message }));
          return { success: false, error: message };
        }

        for (const purchase of premiumPurchases) {
          const didSync = await syncAppStorePurchase(purchase);
          if (didSync) {
            return { success: true };
          }
        }

        const message =
          "Could not restore Premium from the purchases Apple returned.";
        setAppStorePurchaseState((prev) => ({ ...prev, error: message }));
        return { success: false, error: message };
      } catch (error) {
        const message = getAppStoreErrorMessage(error);
        setAppStorePurchaseState((prev) => ({ ...prev, error: message }));
        return { success: false, error: message };
      } finally {
        setAppStorePurchaseState((prev) => ({ ...prev, isRestoring: false }));
      }
    }, [
      appStorePurchaseState.isConnected,
      state.isSignedIn,
      syncAppStorePurchase,
    ]);

  const contextValue = useMemo(
    () => ({
      state,
      apiClient,
      premiumUpsellMode: PREMIUM_UPSELL_MODE,
      appStorePurchaseState,
      signIn,
      signOut,
      sendVerificationCode,
      refreshState,
      getDashboardURL,
      checkPremiumAccess,
      purchasePremium,
      restoreAppStorePurchases,
    }),
    [
      state,
      apiClient,
      appStorePurchaseState,
      signIn,
      signOut,
      sendVerificationCode,
      refreshState,
      getDashboardURL,
      checkPremiumAccess,
      purchasePremium,
      restoreAppStorePurchases,
    ],
  );

  return (
    <CydAccountContext.Provider value={contextValue}>
      {children}
    </CydAccountContext.Provider>
  );
}

function summarizeAppStoreProduct(
  product: ProductSubscription,
): AppStoreProductSummary {
  return {
    productId: product.id,
    title: product.title,
    displayPrice: product.displayPrice,
  };
}

function getAppStoreSyncRequest(
  purchase: Purchase,
): SyncAppStoreSubscriptionAPIRequest | null {
  if (purchase.purchaseToken) {
    return { signed_transaction_jws: purchase.purchaseToken };
  }
  if ("transactionId" in purchase && purchase.transactionId) {
    return { transaction_id: purchase.transactionId };
  }
  if (
    "originalTransactionIdentifierIOS" in purchase &&
    purchase.originalTransactionIdentifierIOS
  ) {
    return {
      original_transaction_id: purchase.originalTransactionIdentifierIOS,
    };
  }
  return null;
}

function isUserCancelledAppStoreError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? String(error.code).toLowerCase() : "";
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  return code.includes("cancel") || message.includes("cancel");
}

function getAppStoreErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  if (typeof error === "string") {
    return error;
  }
  return "Could not complete the App Store purchase. Please try again.";
}

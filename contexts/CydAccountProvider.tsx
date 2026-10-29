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
  CYD_API_ENV,
  GOOGLE_PLAY_SUBSCRIPTIONS_URL,
  GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_IDS,
  PREMIUM_SUBSCRIPTION_PLANS,
  PREMIUM_SUBSCRIPTION_PRODUCT_IDS,
  PREMIUM_UPSELL_MODE,
  STOREFRONT_NAME,
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

// Whether this build sells Premium through a store's own billing system (the
// App Store or Google Play) rather than through the website.
const IS_IN_APP_PURCHASE_MODE =
  PREMIUM_UPSELL_MODE === "app_store_iap" || PREMIUM_UPSELL_MODE === "play_billing";

export type CydAccountState = {
  isSignedIn: boolean;
  userEmail: string | null;
  isLoading: boolean;
  hasPremiumAccess: boolean | null;
};

export type StoreProductSummary = {
  productId: string;
  title: string;
  displayPrice: string;
  // Google Play base-plan offer token, needed to start a Play purchase.
  // Always null for App Store products.
  offerToken: string | null;
};

export type StorePurchaseState = {
  products: Record<BillingPeriod, StoreProductSummary | null>;
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

export type PremiumAccessCheckResult =
  | { status: "premium" }
  | { status: "not_premium" }
  | { status: "signed_out" }
  | { status: "error"; message: string };

export type CydAccountContextType = {
  state: CydAccountState;
  apiClient: CydAPIClient;
  premiumUpsellMode: PremiumUpsellMode;
  storePurchaseState: StorePurchaseState;
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
  getManageSubscriptionURL: () => string;
  checkPremiumAccess: () => Promise<PremiumAccessCheckResult>;
  purchasePremium: (
    billingPeriod: BillingPeriod,
  ) => Promise<PremiumActionResult>;
  restoreStorePurchases: () => Promise<PremiumActionResult>;
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
  const [storePurchaseState, setStorePurchaseState] =
    useState<StorePurchaseState>({
      products: {
        annual: null,
        monthly: null,
      },
      isConnected: false,
      isLoadingProduct: IS_IN_APP_PURCHASE_MODE,
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
      return { status: "signed_out" } as const;
    }
    try {
      const authentication = await apiClient.refreshAuthentication();
      if (authentication !== true) {
        if (authentication.status === 401 || authentication.status === 403) {
          await clearCydAccountCredentials();
          apiClient.setCredentials(null, null);
          setState((prev) => ({
            ...prev,
            isSignedIn: false,
            userEmail: null,
            hasPremiumAccess: false,
          }));
          return { status: "signed_out" } as const;
        }
        return {
          status: "error",
          message: authentication.message,
        } as const;
      }

      const response = await apiClient.getUserPremium();
      if ("error" in response) {
        if (response.status === 401 || response.status === 403) {
          await clearCydAccountCredentials();
          apiClient.setCredentials(null, null);
          setState((prev) => ({
            ...prev,
            isSignedIn: false,
            userEmail: null,
            hasPremiumAccess: false,
          }));
          return { status: "signed_out" } as const;
        }
        return { status: "error", message: response.message } as const;
      } else {
        setState((prev) => ({
          ...prev,
          hasPremiumAccess: response.premium_access,
        }));
        return {
          status: response.premium_access ? "premium" : "not_premium",
        } as const;
      }
    } catch (error) {
      return {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to check Premium access.",
      } as const;
    }
  }, [state.isSignedIn, apiClient]);

  const syncAppStorePurchase = useCallback(
    async (purchase: Purchase): Promise<boolean> => {
      if (!PREMIUM_SUBSCRIPTION_PRODUCT_IDS.includes(purchase.productId)) {
        return false;
      }

      const syncRequest = getAppStoreSyncRequest(purchase);
      if (!syncRequest) {
        setStorePurchaseState((prev) => ({
          ...prev,
          error: "Apple did not return a transaction identifier.",
        }));
        return false;
      }

      const syncResponse =
        await apiClient.syncAppStoreSubscription(syncRequest);
      if ("error" in syncResponse) {
        setStorePurchaseState((prev) => ({
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
      setStorePurchaseState((prev) => ({ ...prev, error: null }));
      return true;
    },
    [apiClient],
  );

  // A Play purchase is only acknowledged (finishTransaction) after cyd-server
  // verifies the purchase token and grants Premium. Play auto-refunds
  // purchases that are left unacknowledged for three days (#124).
  const syncGooglePlayPurchase = useCallback(
    async (purchase: Purchase): Promise<boolean> => {
      if (!GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_IDS.includes(purchase.productId)) {
        return false;
      }

      const purchaseToken = purchase.purchaseToken;
      if (!purchaseToken) {
        setStorePurchaseState((prev) => ({
          ...prev,
          error: "Google Play did not return a purchase token.",
        }));
        return false;
      }

      const syncResponse = await apiClient.syncGooglePlaySubscription({
        purchase_token: purchaseToken,
      });
      if ("error" in syncResponse) {
        setStorePurchaseState((prev) => ({
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
      setStorePurchaseState((prev) => ({ ...prev, error: null }));
      return true;
    },
    [apiClient],
  );

  const syncStorePurchase = useCallback(
    async (purchase: Purchase): Promise<boolean> => {
      if (PREMIUM_UPSELL_MODE === "play_billing") {
        return syncGooglePlayPurchase(purchase);
      }
      return syncAppStorePurchase(purchase);
    },
    [syncAppStorePurchase, syncGooglePlayPurchase],
  );

  useEffect(() => {
    if (!IS_IN_APP_PURCHASE_MODE) {
      return;
    }

    let isActive = true;
    const purchaseUpdateSubscription = purchaseUpdatedListener((purchase) => {
      void (async () => {
        try {
          await syncStorePurchase(purchase);
        } catch (error) {
          setStorePurchaseState((prev) => ({
            ...prev,
            error: getStoreErrorMessage(error),
          }));
        } finally {
          setStorePurchaseState((prev) => ({
            ...prev,
            isPurchasing: false,
          }));
        }
      })();
    });
    const purchaseErrorSubscription = purchaseErrorListener((error) => {
      setStorePurchaseState((prev) => ({
        ...prev,
        isPurchasing: false,
        error: isUserCancelledStoreError(error)
          ? null
          : getStoreErrorMessage(error),
      }));
    });

    void (async () => {
      try {
        await initConnection();
        const products = (await fetchProducts({
          skus: PREMIUM_SUBSCRIPTION_PRODUCT_IDS,
          type: "subs",
        })) as ProductSubscription[];
        const productsByBillingPeriod = PREMIUM_SUBSCRIPTION_PLANS.reduce<
          Record<BillingPeriod, StoreProductSummary | null>
        >(
          (result, plan) => {
            const product = products.find(
              (candidate) => candidate.id === plan.productId,
            );
            result[plan.billingPeriod] = product
              ? summarizeStoreProduct(product)
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
        setStorePurchaseState((prev) => ({
          ...prev,
          products: productsByBillingPeriod,
          isConnected: true,
          isLoadingProduct: false,
          error: hasAvailableProduct
            ? null
            : `Premium is not available ${storefrontAvailabilityPreposition()} ${STOREFRONT_NAME} yet.`,
        }));
      } catch (error) {
        if (!isActive) {
          return;
        }
        setStorePurchaseState((prev) => ({
          ...prev,
          isConnected: false,
          isLoadingProduct: false,
          error: getStoreErrorMessage(error),
        }));
      }
    })();

    return () => {
      isActive = false;
      purchaseUpdateSubscription.remove();
      purchaseErrorSubscription.remove();
      void endConnection();
    };
  }, [syncStorePurchase]);

  const getDashboardURL = useCallback(() => {
    return apiClient.getDashboardURL();
  }, [apiClient]);

  // Where a signed-in person manages their Premium subscription. Play builds
  // send them to Google Play's subscription center; every other build sends
  // them to the website (#124).
  const getManageSubscriptionURL = useCallback(() => {
    if (PREMIUM_UPSELL_MODE === "play_billing") {
      return GOOGLE_PLAY_SUBSCRIPTIONS_URL;
    }
    return apiClient.getDashboardURL();
  }, [apiClient]);

  const purchasePremium = useCallback(
    async (billingPeriod: BillingPeriod): Promise<PremiumActionResult> => {
      if (!IS_IN_APP_PURCHASE_MODE) {
        return {
          success: false,
          error: "Premium uses account management for this build.",
        };
      }
      if (!state.isSignedIn) {
        return { success: false, error: "Please sign in before subscribing." };
      }

      const plan = PREMIUM_SUBSCRIPTION_PLANS.find(
        (candidate) => candidate.billingPeriod === billingPeriod,
      );
      const selectedProduct = plan
        ? storePurchaseState.products[billingPeriod]
        : null;
      if (!plan || !selectedProduct) {
        return {
          success: false,
          error: `That Premium plan is not available ${storefrontAvailabilityPreposition()} ${STOREFRONT_NAME} yet.`,
        };
      }

      setStorePurchaseState((prev) => ({
        ...prev,
        isPurchasing: true,
        error: null,
      }));

      try {
        if (!storePurchaseState.isConnected) {
          await initConnection();
          setStorePurchaseState((prev) => ({ ...prev, isConnected: true }));
        }

        if (PREMIUM_UPSELL_MODE === "play_billing") {
          const subscriptionMetadata =
            await apiClient.getGooglePlaySubscription();
          if ("error" in subscriptionMetadata) {
            setStorePurchaseState((prev) => ({
              ...prev,
              isPurchasing: false,
              error: subscriptionMetadata.message,
            }));
            return {
              success: false,
              error: subscriptionMetadata.message,
            };
          }

          // Play purchases must name the account (via the server-issued
          // obfuscated ID) and the base plan's offer token, so cyd-server can
          // link the purchase to this Cyd account (#124).
          if (!selectedProduct.offerToken) {
            const message = `That Premium plan is not available ${storefrontAvailabilityPreposition()} ${STOREFRONT_NAME} yet.`;
            setStorePurchaseState((prev) => ({
              ...prev,
              isPurchasing: false,
              error: message,
            }));
            return { success: false, error: message };
          }

          await requestPurchase({
            request: {
              google: {
                skus: [plan.productId],
                obfuscatedAccountId: subscriptionMetadata.obfuscated_account_id,
                subscriptionOffers: [
                  { sku: plan.productId, offerToken: selectedProduct.offerToken },
                ],
              },
            },
            type: "subs",
          });
          return { success: true };
        }

        const subscriptionMetadata = await apiClient.getAppStoreSubscription();
        if ("error" in subscriptionMetadata) {
          setStorePurchaseState((prev) => ({
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
        const message = getStoreErrorMessage(error);
        setStorePurchaseState((prev) => ({
          ...prev,
          isPurchasing: false,
          error: message,
        }));
        return { success: false, error: message };
      }
    },
    [apiClient, storePurchaseState, state.isSignedIn],
  );

  const restoreStorePurchases =
    useCallback(async (): Promise<PremiumActionResult> => {
      if (!IS_IN_APP_PURCHASE_MODE) {
        return {
          success: false,
          error: "Restore purchases is only available in App Store and Google Play builds.",
        };
      }
      if (!state.isSignedIn) {
        return {
          success: false,
          error: "Please sign in before restoring purchases.",
        };
      }

      setStorePurchaseState((prev) => ({
        ...prev,
        isRestoring: true,
        error: null,
      }));

      try {
        if (!storePurchaseState.isConnected) {
          await initConnection();
          setStorePurchaseState((prev) => ({ ...prev, isConnected: true }));
        }

        let purchases;
        if (PREMIUM_UPSELL_MODE === "play_billing") {
          // Android returns the store's purchases directly; there is no
          // separate restore call like iOS's.
          purchases = await getAvailablePurchases({});
        } else {
          await restorePurchases();
          purchases = await getAvailablePurchases({
            onlyIncludeActiveItemsIOS: true,
          });
        }
        const premiumPurchases = purchases.filter(
          (purchase) =>
            PREMIUM_SUBSCRIPTION_PRODUCT_IDS.includes(purchase.productId),
        );

        if (premiumPurchases.length === 0) {
          const message =
            PREMIUM_UPSELL_MODE === "play_billing"
              ? "No active Premium purchase was found for this Google Account."
              : "No active Premium purchase was found for this Apple ID.";
          setStorePurchaseState((prev) => ({ ...prev, error: message }));
          return { success: false, error: message };
        }

        for (const purchase of premiumPurchases) {
          const didSync = await syncStorePurchase(purchase);
          if (didSync) {
            return { success: true };
          }
        }

        const message =
          PREMIUM_UPSELL_MODE === "play_billing"
            ? "Could not restore Premium from the purchases Google returned."
            : "Could not restore Premium from the purchases Apple returned.";
        setStorePurchaseState((prev) => ({ ...prev, error: message }));
        return { success: false, error: message };
      } catch (error) {
        const message = getStoreErrorMessage(error);
        setStorePurchaseState((prev) => ({ ...prev, error: message }));
        return { success: false, error: message };
      } finally {
        setStorePurchaseState((prev) => ({ ...prev, isRestoring: false }));
      }
    }, [
      storePurchaseState.isConnected,
      state.isSignedIn,
      syncStorePurchase,
    ]);

  const contextValue = useMemo(
    () => ({
      state,
      apiClient,
      premiumUpsellMode: PREMIUM_UPSELL_MODE,
      storePurchaseState,
      signIn,
      signOut,
      sendVerificationCode,
      refreshState,
      getDashboardURL,
      getManageSubscriptionURL,
      checkPremiumAccess,
      purchasePremium,
      restoreStorePurchases,
    }),
    [
      state,
      apiClient,
      storePurchaseState,
      signIn,
      signOut,
      sendVerificationCode,
      refreshState,
      getDashboardURL,
      getManageSubscriptionURL,
      checkPremiumAccess,
      purchasePremium,
      restoreStorePurchases,
    ],
  );

  return (
    <CydAccountContext.Provider value={contextValue}>
      {children}
    </CydAccountContext.Provider>
  );
}

function summarizeStoreProduct(
  product: ProductSubscription,
): StoreProductSummary {
  return {
    productId: product.id,
    title: product.title,
    displayPrice: product.displayPrice,
    offerToken: getGooglePlayOfferToken(product),
  };
}

// The offer token of the base plan a Play purchase should buy. Play products
// each have one base plan in this app's catalog, so the first offer is the
// one.
function getGooglePlayOfferToken(product: ProductSubscription): string | null {
  if (!("subscriptionOfferDetailsAndroid" in product)) {
    return null;
  }
  const offers = product.subscriptionOfferDetailsAndroid;
  if (offers && offers.length > 0) {
    return offers[0].offerToken;
  }
  return null;
}

// "in the App Store" versus "on Google Play".
function storefrontAvailabilityPreposition(): string {
  return PREMIUM_UPSELL_MODE === "play_billing" ? "on" : "in the";
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

function isUserCancelledStoreError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? String(error.code).toLowerCase() : "";
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  return code.includes("cancel") || message.includes("cancel");
}

function getStoreErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  if (typeof error === "string") {
    return error;
  }
  return `Could not complete the ${STOREFRONT_NAME} purchase. Please try again.`;
}

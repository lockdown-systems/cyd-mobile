import Constants from "expo-constants";
import { Platform } from "react-native";

export type PremiumUpsellMode = "app_store_iap" | "play_billing" | "external_checkout";

type AppExtra = {
  cydApiEnv?: string;
  iosDistribution?: string;
  androidDistribution?: string;
  appStoreAnnualProductId?: string;
  appStoreMonthlyProductId?: string;
  googlePlayAnnualProductId?: string;
  googlePlayMonthlyProductId?: string;
};

type ConstantsWithExtra = {
  expoConfig?: { extra?: AppExtra };
  manifest2?: { extra?: AppExtra };
};

const constants = Constants as ConstantsWithExtra;
const extra = constants.expoConfig?.extra ?? constants.manifest2?.extra ?? {};

export type CydApiEnv = "dev" | "prod";

export const CYD_API_ENV: CydApiEnv =
  extra.cydApiEnv === "prod" || extra.cydApiEnv === "dev"
    ? extra.cydApiEnv
    : __DEV__
      ? "dev"
      : "prod";

export type BillingPeriod = "annual" | "monthly";

export type SubscriptionPlan = {
  billingPeriod: BillingPeriod;
  productId: string;
  periodLabel: "year" | "month";
  displayName: string;
};

export const APP_STORE_ANNUAL_PRODUCT_ID =
  extra.appStoreAnnualProductId ?? "premium_annual";
export const APP_STORE_MONTHLY_PRODUCT_ID =
  extra.appStoreMonthlyProductId ?? "premium_monthly";

export type AppStoreSubscriptionPlan = SubscriptionPlan;

export const APP_STORE_SUBSCRIPTION_PLANS: AppStoreSubscriptionPlan[] = [
  {
    billingPeriod: "annual",
    productId: APP_STORE_ANNUAL_PRODUCT_ID,
    periodLabel: "year",
    displayName: "Annual",
  },
  {
    billingPeriod: "monthly",
    productId: APP_STORE_MONTHLY_PRODUCT_ID,
    periodLabel: "month",
    displayName: "Monthly",
  },
];

export const APP_STORE_SUBSCRIPTION_PRODUCT_IDS =
  APP_STORE_SUBSCRIPTION_PLANS.map((plan) => plan.productId);

export const GOOGLE_PLAY_ANNUAL_PRODUCT_ID =
  extra.googlePlayAnnualProductId ?? "premium_annual";
export const GOOGLE_PLAY_MONTHLY_PRODUCT_ID =
  extra.googlePlayMonthlyProductId ?? "premium_monthly";

export type GooglePlaySubscriptionPlan = SubscriptionPlan;

export const GOOGLE_PLAY_SUBSCRIPTION_PLANS: GooglePlaySubscriptionPlan[] = [
  {
    billingPeriod: "annual",
    productId: GOOGLE_PLAY_ANNUAL_PRODUCT_ID,
    periodLabel: "year",
    displayName: "Annual",
  },
  {
    billingPeriod: "monthly",
    productId: GOOGLE_PLAY_MONTHLY_PRODUCT_ID,
    periodLabel: "month",
    displayName: "Monthly",
  },
];

export const GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_IDS =
  GOOGLE_PLAY_SUBSCRIPTION_PLANS.map((plan) => plan.productId);

export const IOS_DISTRIBUTION = extra.iosDistribution ?? "app_store";
export const ANDROID_DISTRIBUTION = extra.androidDistribution ?? "play";

export const PREMIUM_UPSELL_MODE: PremiumUpsellMode =
  Platform.OS === "ios" && IOS_DISTRIBUTION === "app_store"
    ? "app_store_iap"
    : Platform.OS === "android" && ANDROID_DISTRIBUTION === "play"
      ? "play_billing"
      : "external_checkout";

// The product catalog the current build's storefront sells, and the
// storefront's own name for user-facing copy.
export const PREMIUM_SUBSCRIPTION_PLANS: SubscriptionPlan[] =
  PREMIUM_UPSELL_MODE === "play_billing"
    ? GOOGLE_PLAY_SUBSCRIPTION_PLANS
    : APP_STORE_SUBSCRIPTION_PLANS;

export const PREMIUM_SUBSCRIPTION_PRODUCT_IDS =
  PREMIUM_SUBSCRIPTION_PLANS.map((plan) => plan.productId);

export const STOREFRONT_NAME =
  PREMIUM_UPSELL_MODE === "play_billing" ? "Google Play" : "App Store";

// The Play Store package of the Play build. The non-Play Android build
// (systems.lockdown.cydmobile.alt) never runs play_billing mode, so its
// package has no place here.
export const GOOGLE_PLAY_PACKAGE_NAME = "systems.lockdown.cydmobile";

// Where the Play build sends people to manage or cancel their subscription:
// Google Play's subscription center, not the Cyd account dashboard (#124).
export const GOOGLE_PLAY_SUBSCRIPTIONS_URL = `https://play.google.com/store/account/subscriptions?package=${GOOGLE_PLAY_PACKAGE_NAME}`;

/**
 * @fileoverview Tests for build-time Premium upsell mode selection
 *
 * The Play Store build must sell Premium with Google Play Billing, the
 * non-Play Android build must keep the external checkout, and iOS keeps the
 * App Store flow. Which mode a build gets is decided here, from build
 * metadata (#124).
 */

import { Platform } from "react-native";

type Extra = Record<string, string | undefined>;

type SubscriptionsModule = typeof import("../subscriptions");

function loadSubscriptions(
  os: "ios" | "android",
  extra: Extra,
): SubscriptionsModule {
  (Platform as { OS: string }).OS = os;

  let module: SubscriptionsModule | null = null;
  jest.isolateModules(() => {
    jest.doMock("expo-constants", () => ({
      __esModule: true,
      default: {
        expoConfig: { extra },
        manifest2: undefined,
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    module = (require("../subscriptions") as SubscriptionsModule) ?? null;
  });
  if (!module) {
    throw new Error("failed to load constants/subscriptions");
  }
  return module;
}

const APP_STORE_EXTRA: Extra = { iosDistribution: "app_store" };

describe("Premium upsell mode selection", () => {
  afterEach(() => {
    (Platform as { OS: string }).OS = "ios";
  });

  it("uses Google Play Billing in the Play Store Android build", () => {
    const mod = loadSubscriptions("android", {
      iosDistribution: "app_store",
      androidDistribution: "play",
    });
    expect(mod.PREMIUM_UPSELL_MODE).toBe("play_billing");
  });

  it("defaults the Android distribution to the Play Store build", () => {
    const mod = loadSubscriptions("android", {});
    expect(mod.PREMIUM_UPSELL_MODE).toBe("play_billing");
  });

  it("keeps the external checkout in the non-Play Android build", () => {
    const mod = loadSubscriptions("android", {
      androidDistribution: "other",
    });
    expect(mod.PREMIUM_UPSELL_MODE).toBe("external_checkout");
  });

  it("keeps the App Store flow for iOS App Store builds", () => {
    const mod = loadSubscriptions("ios", APP_STORE_EXTRA);
    expect(mod.PREMIUM_UPSELL_MODE).toBe("app_store_iap");
  });

  it("lets iOS distribution decide iOS builds even when Android env is set", () => {
    const mod = loadSubscriptions("ios", {
      ...APP_STORE_EXTRA,
      androidDistribution: "other",
    });
    expect(mod.PREMIUM_UPSELL_MODE).toBe("app_store_iap");
  });

  it("falls back to the external checkout for non-App-Store iOS builds", () => {
    const mod = loadSubscriptions("ios", { iosDistribution: "altstore_pal" });
    expect(mod.PREMIUM_UPSELL_MODE).toBe("external_checkout");
  });
});

describe("the active subscription catalog", () => {
  afterEach(() => {
    (Platform as { OS: string }).OS = "ios";
  });

  it("uses the App Store product IDs in App Store builds", () => {
    const mod = loadSubscriptions("ios", {
      ...APP_STORE_EXTRA,
      appStoreAnnualProductId: "ios_annual",
      appStoreMonthlyProductId: "ios_monthly",
    });
    expect(mod.PREMIUM_SUBSCRIPTION_PRODUCT_IDS).toEqual([
      "ios_annual",
      "ios_monthly",
    ]);
  });

  it("uses the Google Play product IDs in Play builds", () => {
    const mod = loadSubscriptions("android", {
      androidDistribution: "play",
      googlePlayAnnualProductId: "play_annual",
      googlePlayMonthlyProductId: "play_monthly",
    });
    expect(mod.PREMIUM_SUBSCRIPTION_PRODUCT_IDS).toEqual([
      "play_annual",
      "play_monthly",
    ]);
    expect(
      mod.PREMIUM_SUBSCRIPTION_PLANS.map((plan) => plan.productId),
    ).toEqual(["play_annual", "play_monthly"]);
  });

  it("defaults the Google Play product IDs to the shared catalog", () => {
    const mod = loadSubscriptions("android", {
      androidDistribution: "play",
    });
    expect(mod.GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_IDS).toEqual([
      "premium_annual",
      "premium_monthly",
    ]);
  });
});

describe("storefront naming for user-facing copy", () => {
  afterEach(() => {
    (Platform as { OS: string }).OS = "ios";
  });

  it("names the App Store in App Store builds", () => {
    const mod = loadSubscriptions("ios", APP_STORE_EXTRA);
    expect(mod.STOREFRONT_NAME).toBe("App Store");
  });

  it("names Google Play in Play builds", () => {
    const mod = loadSubscriptions("android", { androidDistribution: "play" });
    expect(mod.STOREFRONT_NAME).toBe("Google Play");
  });
});

describe("the Google Play subscription center link", () => {
  it("targets the Play Store package of the Play build", () => {
    const mod = loadSubscriptions("ios", APP_STORE_EXTRA);
    expect(mod.GOOGLE_PLAY_SUBSCRIPTIONS_URL).toBe(
      "https://play.google.com/store/account/subscriptions?package=systems.lockdown.cydmobile",
    );
  });
});

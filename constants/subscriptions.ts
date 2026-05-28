import Constants from "expo-constants";
import { Platform } from "react-native";

export type PremiumUpsellMode = "app_store_iap" | "external_checkout";

type AppExtra = {
  iosDistribution?: string;
  appStoreAnnualProductId?: string;
};

type ConstantsWithExtra = {
  expoConfig?: { extra?: AppExtra };
  manifest2?: { extra?: AppExtra };
};

const constants = Constants as ConstantsWithExtra;
const extra = constants.expoConfig?.extra ?? constants.manifest2?.extra ?? {};

export const APP_STORE_ANNUAL_PRODUCT_ID =
  extra.appStoreAnnualProductId ?? "premium_annual";

export const IOS_DISTRIBUTION = extra.iosDistribution ?? "app_store";

export const PREMIUM_UPSELL_MODE: PremiumUpsellMode =
  Platform.OS === "ios" && IOS_DISTRIBUTION === "app_store"
    ? "app_store_iap"
    : "external_checkout";

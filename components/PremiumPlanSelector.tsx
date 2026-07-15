import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  APP_STORE_SUBSCRIPTION_PLANS,
  type BillingPeriod,
} from "@/constants/subscriptions";
import type { AppStorePurchaseState } from "@/contexts/CydAccountProvider";
import type { AccountTabPalette } from "@/types/account-tabs";

type PremiumPlanSelectorProps = {
  palette: AccountTabPalette;
  products: AppStorePurchaseState["products"];
  selectedBillingPeriod: BillingPeriod;
  onSelect: (billingPeriod: BillingPeriod) => void;
  disabled?: boolean;
};

export function PremiumPlanSelector({
  palette,
  products,
  selectedBillingPeriod,
  onSelect,
  disabled = false,
}: PremiumPlanSelectorProps) {
  return (
    <View style={styles.container} accessibilityRole="radiogroup">
      {APP_STORE_SUBSCRIPTION_PLANS.map((plan) => {
        const product = products[plan.billingPeriod];
        const isSelected = selectedBillingPeriod === plan.billingPeriod;
        const isDisabled = disabled || !product;

        return (
          <Pressable
            key={plan.billingPeriod}
            onPress={() => onSelect(plan.billingPeriod)}
            disabled={isDisabled}
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected, disabled: isDisabled }}
            accessibilityLabel={`${plan.displayName} Premium plan`}
            style={({ pressed }) => [
              styles.option,
              {
                borderColor: isSelected ? palette.tint : palette.icon + "33",
                backgroundColor: isSelected
                  ? palette.tint + "18"
                  : palette.card,
                opacity: isDisabled ? 0.55 : pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={[styles.name, { color: palette.text }]}>
              {plan.displayName}
            </Text>
            <Text style={[styles.price, { color: palette.icon }]}>
              {product
                ? `${product.displayPrice}/${plan.periodLabel}`
                : "Unavailable"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: 8,
    width: "100%",
  },
  option: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    gap: 2,
  },
  name: {
    fontSize: 14,
    fontWeight: "600",
  },
  price: {
    fontSize: 13,
  },
});

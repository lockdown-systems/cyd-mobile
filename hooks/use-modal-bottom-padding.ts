import { useMemo } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type UseModalBottomPaddingOptions = {
  minPadding?: number;
  insetOffset?: number;
};

export function useModalBottomPadding(
  options: UseModalBottomPaddingOptions = {},
) {
  const { minPadding = 24, insetOffset = 8 } = options;
  const insets = useSafeAreaInsets();

  return useMemo(
    () => Math.max(insets.bottom + insetOffset, minPadding),
    [insets.bottom, insetOffset, minPadding],
  );
}

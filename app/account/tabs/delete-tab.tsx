import { TabPlaceholder } from "./tab-placeholder";
import type { AccountTabProps } from "./types";

export function DeleteTab({
  accountId: _accountId,
  handle,
  palette,
}: AccountTabProps) {
  return (
    <TabPlaceholder
      palette={palette}
      message={`Delete coming soon for ${handle}.`}
    />
  );
}

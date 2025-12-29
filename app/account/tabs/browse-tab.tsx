import { TabPlaceholder } from "./tab-placeholder";
import type { AccountTabProps } from "./types";

export function BrowseTab({
  accountId: _accountId,
  handle,
  palette,
}: AccountTabProps) {
  return (
    <TabPlaceholder
      palette={palette}
      message={`Browse coming soon for ${handle}.`}
    />
  );
}

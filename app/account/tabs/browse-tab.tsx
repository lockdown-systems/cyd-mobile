import type { AccountTabProps } from "@/types/account-tabs";
import { TabPlaceholder } from "./tab-placeholder";

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

export default BrowseTab;

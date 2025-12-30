import type { AccountTabProps } from "@/types/account-tabs";
import { TabPlaceholder } from "./tab-placeholder";

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

export default DeleteTab;

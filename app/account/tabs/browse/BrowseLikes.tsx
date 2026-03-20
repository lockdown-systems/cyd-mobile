import {
    BrowseList,
    type BrowseProps,
} from "@/components/account/browse-shared";

export function BrowseLikes({
  handle,
  palette,
  accountId,
  accountUUID,
  onCountChange,
}: BrowseProps) {
  return (
    <BrowseList
      handle={handle}
      palette={palette}
      accountId={accountId}
      accountUUID={accountUUID}
      type="likes"
      onCountChange={onCountChange}
    />
  );
}

export default BrowseLikes;

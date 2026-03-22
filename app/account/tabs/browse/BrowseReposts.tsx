import {
    BrowseList,
    type BrowseProps,
} from "@/components/account/browse-shared";

export function BrowseReposts({
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
      type="reposts"
      onCountChange={onCountChange}
    />
  );
}

export default BrowseReposts;

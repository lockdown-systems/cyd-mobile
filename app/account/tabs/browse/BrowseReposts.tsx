import {
  BrowseList,
  type BrowseProps,
} from "@/components/account/browse-shared";

export function BrowseReposts({
  handle,
  palette,
  accountId,
  onCountChange,
}: BrowseProps) {
  return (
    <BrowseList
      handle={handle}
      palette={palette}
      accountId={accountId}
      type="reposts"
      onCountChange={onCountChange}
    />
  );
}

export default BrowseReposts;

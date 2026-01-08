import { BrowseList, type BrowseProps } from "./shared";

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

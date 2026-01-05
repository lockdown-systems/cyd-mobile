import { BrowseList, type BrowseProps } from "./shared";

export function BrowseLikes({
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
      type="likes"
      onCountChange={onCountChange}
    />
  );
}

export default BrowseLikes;

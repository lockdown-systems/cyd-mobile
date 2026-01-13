import { BrowseList, type BrowseProps } from "./_shared";

export function BrowseBookmarks({
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
      type="bookmarks"
      onCountChange={onCountChange}
    />
  );
}

export default BrowseBookmarks;

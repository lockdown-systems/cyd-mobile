import {
    BrowseList,
    type BrowseProps,
} from "@/components/account/browse-shared";

export function BrowseBookmarks({
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
      type="bookmarks"
      onCountChange={onCountChange}
    />
  );
}

export default BrowseBookmarks;

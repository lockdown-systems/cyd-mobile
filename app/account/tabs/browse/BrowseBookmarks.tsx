import { BrowseList, type BrowseProps } from "./shared";

export function BrowseBookmarks({ handle, palette, accountId }: BrowseProps) {
  return (
    <BrowseList
      handle={handle}
      palette={palette}
      accountId={accountId}
      type="bookmarks"
    />
  );
}

export default BrowseBookmarks;

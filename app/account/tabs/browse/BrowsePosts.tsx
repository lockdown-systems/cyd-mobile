import { BrowseList, type BrowseProps } from "./_shared";

export function BrowsePosts({
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
      type="posts"
      onCountChange={onCountChange}
    />
  );
}

export default BrowsePosts;

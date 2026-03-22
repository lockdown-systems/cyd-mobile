import {
    BrowseList,
    type BrowseProps,
} from "@/components/account/browse-shared";

export function BrowsePosts({
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
      type="posts"
      onCountChange={onCountChange}
    />
  );
}

export default BrowsePosts;

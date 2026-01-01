import { BrowseList, type BrowseProps } from "./shared";

export function BrowsePosts({ handle, palette, accountId }: BrowseProps) {
  return (
    <BrowseList
      handle={handle}
      palette={palette}
      accountId={accountId}
      type="posts"
    />
  );
}

export default BrowsePosts;

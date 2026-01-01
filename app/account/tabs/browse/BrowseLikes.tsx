import { BrowseList, type BrowseProps } from "./shared";

export function BrowseLikes({ handle, palette, accountId }: BrowseProps) {
  return (
    <BrowseList
      handle={handle}
      palette={palette}
      accountId={accountId}
      type="likes"
    />
  );
}

export default BrowseLikes;

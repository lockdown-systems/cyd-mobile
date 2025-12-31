import type { AccountTabPalette } from "@/types/account-tabs";

import { BrowsePlaceholderCard } from "./BrowsePlaceholderCard";

type Props = {
  handle: string;
  palette: AccountTabPalette;
};

export function BrowseBookmarks({ handle, palette }: Props) {
  return (
    <BrowsePlaceholderCard
      palette={palette}
      title="Bookmarks"
      message={`Bookmarks for ${handle} will show up here soon.`}
    />
  );
}

export default BrowseBookmarks;

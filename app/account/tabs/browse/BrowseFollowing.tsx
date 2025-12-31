import type { AccountTabPalette } from "@/types/account-tabs";

import { BrowsePlaceholderCard } from "./BrowsePlaceholderCard";

type Props = {
  handle: string;
  palette: AccountTabPalette;
};

export function BrowseFollowing({ handle, palette }: Props) {
  return (
    <BrowsePlaceholderCard
      palette={palette}
      title="Following"
      message={`Following data for ${handle} will show up here soon.`}
    />
  );
}

export default BrowseFollowing;

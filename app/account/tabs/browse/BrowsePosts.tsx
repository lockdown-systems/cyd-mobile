import type { AccountTabPalette } from "@/types/account-tabs";

import { BrowsePlaceholderCard } from "./BrowsePlaceholderCard";

type Props = {
  handle: string;
  palette: AccountTabPalette;
};

export function BrowsePosts({ handle, palette }: Props) {
  return (
    <BrowsePlaceholderCard
      palette={palette}
      title="Posts"
      message={`Saved posts for ${handle} will show up here soon.`}
    />
  );
}

export default BrowsePosts;

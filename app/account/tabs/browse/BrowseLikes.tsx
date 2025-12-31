import type { AccountTabPalette } from "@/types/account-tabs";

import { BrowsePlaceholderCard } from "./BrowsePlaceholderCard";

type Props = {
  handle: string;
  palette: AccountTabPalette;
};

export function BrowseLikes({ handle, palette }: Props) {
  return (
    <BrowsePlaceholderCard
      palette={palette}
      title="Likes"
      message={`Likes for ${handle} will show up here soon.`}
    />
  );
}

export default BrowseLikes;

import type { AccountTabPalette } from "@/types/account-tabs";

import { BrowsePlaceholderCard } from "./BrowsePlaceholderCard";

type Props = {
  handle: string;
  palette: AccountTabPalette;
};

export function BrowseMessages({ handle, palette }: Props) {
  return (
    <BrowsePlaceholderCard
      palette={palette}
      title="Messages"
      message={`Messages for ${handle} will show up here soon.`}
    />
  );
}

export default BrowseMessages;

import type {
  RestoredMobileAccount,
  MobileBookmarkWrite,
  MobileConversationWrite,
  MobileFollowWrite,
  MobileMediaAssetWrite,
  MobileMessageWrite,
  MobilePostExternalWrite,
  MobilePostMediaWrite,
  MobilePostWrite,
  MobileProfileWrite,
} from "@/services/archive-restore";

/**
 * The rows a Bluesky local account already holds, in the shape a restore
 * writes them.
 *
 * A merge compares two descriptions of the same Bluesky saved data, so both
 * sides have to be the same shape. Restore's row types are that shape, plus
 * the few columns that only a live account has: a person's own decision to
 * preserve a post, and what Cyd's downloader has been through with a file.
 * They are local facts an archive cannot know, so the merge carries them
 * across untouched rather than letting an `INSERT OR REPLACE` quietly reset
 * them.
 */

export type ExistingPostRow = MobilePostWrite & {
  /** The person's own "never delete this", which no archive may clear. */
  preserve: number;
};

export type ExistingMediaAssetRow = Omit<
  MobileMediaAssetWrite,
  "downloadState"
> & {
  downloadState: "pending" | "downloading" | "complete" | "failed";
  attemptCount: number;
};

export type ExistingAccountRows = {
  profiles: MobileProfileWrite[];
  posts: ExistingPostRow[];
  postMedia: MobilePostMediaWrite[];
  postExternals: MobilePostExternalWrite[];
  bookmarks: MobileBookmarkWrite[];
  follows: MobileFollowWrite[];
  conversations: MobileConversationWrite[];
  messages: MobileMessageWrite[];
  mediaAssets: ExistingMediaAssetRow[];
};

/**
 * A Cyd Bluesky archive's rows, in the shape the account holds them.
 *
 * The two columns an archive cannot know get the value a newly saved record
 * would have, and the union rules carry the account's own values across, so an
 * archive can never reset a person's own decision to preserve a post or a
 * downloader's record of what it has been through.
 */
export function accountRowsFromArchive(
  restored: RestoredMobileAccount,
): ExistingAccountRows {
  return {
    profiles: restored.profiles,
    posts: restored.posts.map((row) => ({ ...row, preserve: 0 })),
    postMedia: restored.postMedia,
    postExternals: restored.postExternals,
    bookmarks: restored.bookmarks,
    follows: restored.follows,
    conversations: restored.conversations,
    messages: restored.messages,
    mediaAssets: restored.mediaAssets.map((row) => ({
      ...row,
      attemptCount: 0,
    })),
  };
}

export type {
  MobileBookmarkWrite,
  MobileConversationWrite,
  MobileFollowWrite,
  MobileMessageWrite,
  MobilePostExternalWrite,
  MobilePostMediaWrite,
  MobilePostWrite,
  MobileProfileWrite,
};

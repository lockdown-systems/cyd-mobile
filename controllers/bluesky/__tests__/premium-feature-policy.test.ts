import type { AccountDeleteSettings } from "@/database/delete-settings";

import {
  deleteSettingsRequirePremium,
  saveAndDeleteOptionsRequirePremium,
} from "../premium-feature-policy";

const noDeletesSelected: AccountDeleteSettings = {
  deletePosts: false,
  deletePostsDaysOldEnabled: false,
  deletePostsDaysOld: 0,
  deletePostsLikesThresholdEnabled: false,
  deletePostsLikesThreshold: 0,
  deletePostsRepostsThresholdEnabled: false,
  deletePostsRepostsThreshold: 0,
  deletePostsPreserveThreads: false,
  deleteReposts: false,
  deleteRepostsDaysOldEnabled: false,
  deleteRepostsDaysOld: 0,
  deleteLikes: false,
  deleteLikesDaysOldEnabled: false,
  deleteLikesDaysOld: 0,
  deleteBookmarks: false,
  deleteChats: false,
  deleteChatsDaysOldEnabled: false,
  deleteChatsDaysOld: 0,
  deleteUnfollowEveryone: false,
};

describe("premium feature policy", () => {
  it("allows every save feature without Premium when no delete feature is selected", () => {
    expect(
      saveAndDeleteOptionsRequirePremium({
        saveOptions: {
          posts: true,
          likes: true,
          bookmarks: true,
          chat: true,
        },
        deleteOptions: { settings: noDeletesSelected },
      }),
    ).toBe(false);
  });

  it.each<keyof AccountDeleteSettings>([
    "deletePosts",
    "deleteReposts",
    "deleteLikes",
    "deleteBookmarks",
    "deleteChats",
    "deleteUnfollowEveryone",
  ])("requires Premium when %s is selected", (feature) => {
    expect(
      deleteSettingsRequirePremium({
        ...noDeletesSelected,
        [feature]: true,
      }),
    ).toBe(true);
  });

  it("ignores delete filters when their parent delete feature is not selected", () => {
    expect(
      deleteSettingsRequirePremium({
        ...noDeletesSelected,
        deletePostsDaysOldEnabled: true,
        deletePostsLikesThresholdEnabled: true,
        deletePostsRepostsThresholdEnabled: true,
        deletePostsPreserveThreads: true,
        deleteRepostsDaysOldEnabled: true,
        deleteLikesDaysOldEnabled: true,
        deleteChatsDaysOldEnabled: true,
      }),
    ).toBe(false);
  });
});

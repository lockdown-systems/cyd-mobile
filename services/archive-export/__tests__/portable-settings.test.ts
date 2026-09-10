import { portableSettingsFromAccountRow } from "../portable-settings";

describe("portableSettingsFromAccountRow", () => {
  it("carries the save and delete defaults an account chose", () => {
    expect(
      portableSettingsFromAccountRow({
        settingSavePosts: 1,
        settingSaveLikes: 0,
        settingSaveBookmarks: 1,
        settingSaveChats: 0,
        settingDeletePosts: 1,
        settingDeleteReposts: 0,
        settingDeleteLikes: 1,
        settingDeleteBookmarks: 0,
        settingDeleteChats: 1,
        settingDeleteUnfollowEveryone: 0,
      }),
    ).toEqual({
      save_posts: true,
      save_likes: false,
      save_bookmarks: true,
      save_chats: false,
      delete_posts: true,
      delete_reposts: false,
      delete_likes: true,
      delete_bookmarks: false,
      delete_chats: true,
      delete_follows: false,
    });
  });

  it("says nothing about a setting Mobile does not have", () => {
    const settings = portableSettingsFromAccountRow({ settingSavePosts: 1 });

    expect(settings).toEqual({ save_posts: true });
    expect("save_reposts" in settings).toBe(false);
  });

  it("carries nothing at all when the account row is missing", () => {
    expect(portableSettingsFromAccountRow(null)).toEqual({});
  });
});

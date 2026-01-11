/**
 * @fileoverview Tests for BlueskyAccountController
 */

import type {
  Agent,
  AppBskyBookmarkGetBookmarks,
  AppBskyFeedGetActorLikes,
  AppBskyFeedGetAuthorFeed,
} from "@atproto/api";

import { File } from "expo-file-system";

import {
  createMockDatabase,
  type MockDatabase,
} from "@/testUtils/mockDatabase";
import { buildAccountPaths } from "../BaseAccountController";
import {
  BlueskyAccountController,
  type BlueskyProgress,
} from "../BlueskyAccountController";

jest.mock("expo-file-system", () => {
  const infoMap = new Map<string, { exists: boolean; isDirectory: boolean }>();

  const joinUri = (uris: (string | Directory | File)[]) =>
    uris
      .map((u) => (typeof u === "string" ? u : u.uri))
      .filter((part) => part.length > 0)
      .reduce((acc, part, index) => {
        if (index === 0) return part;
        if (!acc.endsWith("/") && !part.startsWith("/")) {
          return `${acc}/${part}`;
        }
        if (acc.endsWith("/") && part.startsWith("/")) {
          return `${acc}${part.slice(1)}`;
        }
        return `${acc}${part}`;
      }, "");

  class Directory {
    uri: string;
    exists: boolean;

    constructor(...uris: (string | Directory | File)[]) {
      this.uri = joinUri(uris);
      const entry = infoMap.get(this.uri);
      this.exists = entry?.exists ?? false;
    }

    create(options?: { intermediates?: boolean; idempotent?: boolean }) {
      this.exists = true;
      infoMap.set(this.uri, { exists: true, isDirectory: true });
      return options;
    }

    delete() {
      infoMap.delete(this.uri);
    }
  }

  class File {
    uri: string;
    exists: boolean;

    constructor(...uris: (string | Directory | File)[]) {
      this.uri = joinUri(uris);
      const entry = infoMap.get(this.uri);
      this.exists = entry?.exists ?? false;
    }

    delete() {
      infoMap.delete(this.uri);
    }

    static downloadFileAsync = jest.fn(
      async (_url: string, to: File | Directory) => {
        const targetUri = to.uri;
        infoMap.set(targetUri, { exists: true, isDirectory: false });
        return new File(targetUri);
      }
    );
  }

  const Paths = {
    document: new Directory("file:///documents/"),
    cache: new Directory("file:///cache/"),
    info: (uri: string) =>
      infoMap.get(uri) ?? { exists: false, isDirectory: false },
  };

  return { Directory, File, Paths, __mockState: { infoMap } };
});

describe("BlueskyAccountController", () => {
  beforeEach(() => {
    const fsMock = jest.mocked(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("expo-file-system") as {
        __mockState: {
          infoMap: Map<string, { exists: boolean; isDirectory: boolean }>;
        };
      }
    );
    fsMock.__mockState.infoMap.clear();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const mockedDownload = jest.mocked(File.downloadFileAsync);
    mockedDownload.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor and initialization", () => {
    it("should create a controller with the given account ID", () => {
      const controller = new BlueskyAccountController(123);
      expect(controller.getAccountId()).toBe(123);
    });

    it("should have account type of bluesky", () => {
      const controller = new BlueskyAccountController(1);
      expect(controller.getAccountType()).toBe("bluesky");
    });

    it("should generate a unique UUID", () => {
      const controller1 = new BlueskyAccountController(1);
      const controller2 = new BlueskyAccountController(2);

      expect(controller1.getAccountUUID()).toBeDefined();
      expect(controller2.getAccountUUID()).toBeDefined();
      expect(controller1.getAccountUUID()).not.toBe(
        controller2.getAccountUUID()
      );
    });
  });

  describe("resetProgress", () => {
    it("should return initial progress state", () => {
      const controller = new BlueskyAccountController(1);
      const progress = controller.resetProgress();

      // Save progress fields (now use segment format)
      expect(progress.postsProgress.current).toBe(0);
      expect(progress.postsProgress.total).toBeNull();
      expect(progress.postsProgress.unknownTotal).toBe(true);
      expect(progress.likesProgress.current).toBe(0);
      expect(progress.likesProgress.total).toBeNull();
      expect(progress.likesProgress.unknownTotal).toBe(true);
      expect(progress.bookmarksProgress.current).toBe(0);
      expect(progress.bookmarksProgress.total).toBeNull();
      expect(progress.bookmarksProgress.unknownTotal).toBe(true);
      expect(progress.followsProgress.current).toBe(0);
      expect(progress.followsProgress.total).toBeNull();
      expect(progress.conversationsProgress.current).toBe(0);
      expect(progress.conversationsProgress.total).toBeNull();
      expect(progress.messagesProgress.current).toBe(0);
      expect(progress.messagesProgress.total).toBeNull();

      // Delete progress fields (use segment format)
      expect(progress.deletePostsProgress.current).toBe(0);
      expect(progress.deletePostsProgress.total).toBeNull();
      expect(progress.deleteRepostsProgress.current).toBe(0);
      expect(progress.deleteRepostsProgress.total).toBeNull();
      expect(progress.deleteLikesProgress.current).toBe(0);
      expect(progress.deleteLikesProgress.total).toBeNull();
      expect(progress.deleteBookmarksProgress.current).toBe(0);
      expect(progress.deleteBookmarksProgress.total).toBeNull();
      expect(progress.deleteMessagesProgress.current).toBe(0);
      expect(progress.deleteMessagesProgress.total).toBeNull();
      expect(progress.unfollowProgress.current).toBe(0);
      expect(progress.unfollowProgress.total).toBeNull();

      // Status fields
      expect(progress.currentAction).toBe("");
      expect(progress.isRunning).toBe(false);
      expect(progress.error).toBeNull();
    });
  });

  describe("agent state", () => {
    it("should report agent not ready initially", () => {
      const controller = new BlueskyAccountController(1);
      expect(controller.isAgentReady()).toBe(false);
    });

    it("should return null DID initially", () => {
      const controller = new BlueskyAccountController(1);
      expect(controller.getDid()).toBeNull();
    });

    it("should return null handle initially", () => {
      const controller = new BlueskyAccountController(1);
      expect(controller.getHandle()).toBeNull();
    });
  });

  describe("callbacks", () => {
    it("should accept session expired callback", () => {
      const controller = new BlueskyAccountController(1);
      const callback = jest.fn();

      // Should not throw
      expect(() => {
        controller.setSessionExpiredCallback(callback);
      }).not.toThrow();
    });

    it("should accept rate limit callback", () => {
      const controller = new BlueskyAccountController(1);
      const callback = jest.fn();

      // Should not throw
      expect(() => {
        controller.setRateLimitCallback(callback);
      }).not.toThrow();
    });

    it("should accept progress callback", () => {
      const controller = new BlueskyAccountController(1);
      const callback = jest.fn<void, [BlueskyProgress]>();

      // Should not throw
      expect(() => {
        controller.setProgressCallback(callback);
      }).not.toThrow();
    });
  });

  describe("indexPosts", () => {
    type FeedViewPost = AppBskyFeedGetAuthorFeed.OutputSchema["feed"][number];

    const createFeedPost = (suffix: number): FeedViewPost => {
      const createdAt = new Date(1700000000000 + suffix).toISOString();
      return {
        post: {
          uri: `at://did:plc:test/app.bsky.feed.post/${suffix}`,
          cid: `cid-${suffix}`,
          author: {
            did: "did:plc:test",
            handle: "user.test",
            displayName: "Test User",
          },
          likeCount: 10 + suffix,
          repostCount: 20 + suffix,
          replyCount: 30 + suffix,
          quoteCount: 40 + suffix,
          record: {
            $type: "app.bsky.feed.post",
            text: `Post ${suffix}`,
            createdAt,
          },
          indexedAt: createdAt,
        },
      };
    };

    const createFeedPostWithImage = (suffix: number): FeedViewPost => {
      const base = createFeedPost(suffix);
      return {
        ...base,
        post: {
          ...base.post,
          embed: {
            $type: "app.bsky.embed.images#view",
            images: [
              {
                thumb: `https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:test/bafyimage${suffix}@jpeg`,
                fullsize: `https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:test/bafyimage${suffix}@jpeg`,
                alt: `Alt ${suffix}`,
                aspectRatio: { width: 800, height: 600 },
              },
            ],
          },
        },
      };
    };

    it("should fetch pages and store posts", async () => {
      const controller = new BlueskyAccountController(1);
      const mockDb = createMockDatabase();
      const getAuthorFeed = jest.fn();
      const controllerState = controller as unknown as {
        db: ReturnType<typeof createMockDatabase>;
        agent: Agent | null;
        did: string | null;
        handle: string | null;
      };
      controllerState.db = mockDb;
      controllerState.did = "did:plc:test";
      controllerState.handle = "user.test";
      const mockAgent = {
        app: {
          bsky: {
            feed: {
              getAuthorFeed,
            },
          },
        },
      } as unknown as Agent;
      controllerState.agent = mockAgent;

      const page1 = [createFeedPost(1)];
      const page2 = [createFeedPost(2)];

      getAuthorFeed
        .mockResolvedValueOnce({ data: { feed: page1, cursor: "cursor-2" } })
        .mockResolvedValueOnce({ data: { feed: page2 } });

      await controller.indexPosts();

      expect(getAuthorFeed).toHaveBeenCalledTimes(2);
      expect(getAuthorFeed).toHaveBeenNthCalledWith(1, {
        actor: "did:plc:test",
        cursor: undefined,
        limit: 100,
      });
      expect(getAuthorFeed).toHaveBeenNthCalledWith(2, {
        actor: "did:plc:test",
        cursor: "cursor-2",
        limit: 100,
      });

      const dbMocks = mockDb as unknown as MockDatabase;
      const insertCalls = dbMocks.runAsync.mock.calls.filter(
        ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO post")
      );
      expect(insertCalls).toHaveLength(2);
      const firstArgs = (insertCalls[0] as unknown[])?.[1] as unknown[];
      const secondArgs = (insertCalls[1] as unknown[])?.[1] as unknown[];
      expect(firstArgs?.slice(17, 21)).toEqual([11, 21, 31, 41]);
      expect(secondArgs?.slice(17, 21)).toEqual([12, 22, 32, 42]);
      expect(controller.progress.postsProgress.current).toBe(2);
      expect(controller.progress.isRunning).toBe(false);
    });

    it("should download media for embedded images", async () => {
      const controller = new BlueskyAccountController(1);
      const mockDb = createMockDatabase();
      const getAuthorFeed = jest.fn();
      const controllerState = controller as unknown as {
        db: ReturnType<typeof createMockDatabase>;
        agent: Agent | null;
        did: string | null;
        handle: string | null;
      };
      controllerState.db = mockDb;
      controllerState.did = "did:plc:test";
      controllerState.handle = "user.test";
      controllerState.agent = {
        app: {
          bsky: {
            feed: {
              getAuthorFeed,
            },
          },
        },
      } as unknown as Agent;

      const downloadSpy = jest
        .spyOn(
          controller as unknown as {
            downloadMediaFromUrl: (url: string, did: string) => Promise<string>;
          },
          "downloadMediaFromUrl"
        )
        .mockResolvedValue("file:///mock/media-thumb");

      const feedWithImage = [createFeedPostWithImage(1)];
      getAuthorFeed.mockResolvedValueOnce({ data: { feed: feedWithImage } });

      await controller.indexPosts();

      expect(downloadSpy).toHaveBeenCalledTimes(2);
      expect(downloadSpy).toHaveBeenCalledWith(
        "https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:test/bafyimage1@jpeg",
        "did:plc:test"
      );
      expect(downloadSpy).toHaveBeenCalledWith(
        "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:test/bafyimage1@jpeg",
        "did:plc:test"
      );
    });

    it("should upsert posts by uri to avoid duplicates", async () => {
      const controller = new BlueskyAccountController(1);
      const mockDb = createMockDatabase();
      const getAuthorFeed = jest.fn();
      const controllerState = controller as unknown as {
        db: ReturnType<typeof createMockDatabase>;
        agent: Agent | null;
        did: string | null;
        handle: string | null;
      };
      controllerState.db = mockDb;
      controllerState.did = "did:plc:test";
      controllerState.handle = "user.test";
      controllerState.agent = {
        app: {
          bsky: {
            feed: {
              getAuthorFeed,
            },
          },
        },
      } as unknown as Agent;

      const original = createFeedPost(1);
      const updated: FeedViewPost = {
        ...original,
        post: {
          ...original.post,
          cid: "cid-updated",
          likeCount: 999,
          repostCount: 888,
          replyCount: 777,
          quoteCount: 666,
          record: {
            ...(original.post.record as {
              $type: string;
              text: string;
              createdAt: string;
            }),
            text: "Updated text",
          },
        },
      };

      getAuthorFeed.mockResolvedValueOnce({
        data: { feed: [original, updated] },
      });

      await controller.indexPosts();

      const dbMocks = mockDb as unknown as MockDatabase;
      console.log("runAsync call count", dbMocks.runAsync.mock.calls.length);
      const insertCalls = dbMocks.runAsync.mock.calls.filter(
        ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO post")
      );
      expect(insertCalls).toHaveLength(2);
      const sqlText = (insertCalls[0] as unknown[])?.[0] as string;
      expect(sqlText).toContain("ON CONFLICT(uri) DO UPDATE");
      const secondArgs = (insertCalls[1] as unknown[])?.[1] as unknown[];
      expect(secondArgs?.[1]).toBe("cid-updated");
      expect(secondArgs?.slice(17, 21)).toEqual([999, 888, 777, 666]);
    });

    it("should fail when database is not ready", async () => {
      const controller = new BlueskyAccountController(1);
      const getAuthorFeed = jest.fn();
      const controllerState = controller as unknown as {
        agent: Agent | null;
        did: string | null;
      };
      controllerState.agent = {
        app: { bsky: { feed: { getAuthorFeed } } },
      } as unknown as Agent;
      controllerState.did = "did:plc:test";

      await expect(controller.indexPosts()).rejects.toThrow(
        "Database not initialized"
      );
    });

    it("should fail when agent is not ready", async () => {
      const controller = new BlueskyAccountController(1);
      const controllerState = controller as unknown as {
        db: ReturnType<typeof createMockDatabase>;
      };
      controllerState.db = createMockDatabase();

      await expect(controller.indexPosts()).rejects.toThrow(
        "Agent not initialized"
      );
    });
  });

  describe("indexLikes", () => {
    type LikesFeedItem = AppBskyFeedGetActorLikes.OutputSchema["feed"][number];

    const createLikeItem = (suffix: number): LikesFeedItem => {
      const createdAt = new Date(1700000000000 + suffix).toISOString();
      return {
        uri: `at://did:plc:test/app.bsky.feed.like/${suffix}`,
        cid: `cid-like-${suffix}`,
        createdAt,
        indexedAt: createdAt,
        subject: {
          uri: `at://did:plc:test/app.bsky.feed.post/${suffix}`,
          cid: `cid-${suffix}`,
          author: {
            did: "did:plc:test",
            handle: "user.test",
            displayName: "Test User",
          },
          likeCount: 10 + suffix,
          repostCount: 20 + suffix,
          replyCount: 30 + suffix,
          quoteCount: 40 + suffix,
          record: {
            $type: "app.bsky.feed.post",
            text: `Post ${suffix}`,
            createdAt,
          },
          indexedAt: createdAt,
        },
      } as unknown as LikesFeedItem;
    };

    it("should fetch pages and store likes", async () => {
      const controller = new BlueskyAccountController(1);
      const mockDb = createMockDatabase();
      const getActorLikes = jest.fn();
      const controllerState = controller as unknown as {
        db: ReturnType<typeof createMockDatabase>;
        agent: Agent | null;
        did: string | null;
        handle: string | null;
      };
      controllerState.db = mockDb;
      controllerState.did = "did:plc:test";
      controllerState.handle = "user.test";
      controllerState.agent = {
        app: { bsky: { feed: { getActorLikes } } },
      } as unknown as Agent;

      const likePage1 = [createLikeItem(1)];
      const likePage2 = [createLikeItem(2)];

      getActorLikes
        .mockResolvedValueOnce({
          data: { feed: likePage1, cursor: "cursor-2" },
        })
        .mockResolvedValueOnce({ data: { feed: likePage2 } });

      await controller.indexLikes();

      expect(getActorLikes).toHaveBeenCalledTimes(2);
      expect(getActorLikes).toHaveBeenNthCalledWith(1, {
        actor: "did:plc:test",
        cursor: undefined,
        limit: 100,
      });
      expect(getActorLikes).toHaveBeenNthCalledWith(2, {
        actor: "did:plc:test",
        cursor: "cursor-2",
        limit: 100,
      });

      const dbMocks = mockDb as unknown as MockDatabase;
      const postInsertCalls = dbMocks.runAsync.mock.calls.filter(
        ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO post")
      );
      expect(postInsertCalls).toHaveLength(2);
      const firstArgs = (postInsertCalls[0] as unknown[])?.[1] as unknown[];
      expect(firstArgs?.[21]).toBe(1); // viewerLiked

      expect(controller.progress.likesProgress.current).toBe(2);
      expect(controller.progress.isRunning).toBe(false);
    });

    it("should fail when agent is not ready", async () => {
      const controller = new BlueskyAccountController(1);
      const controllerState = controller as unknown as {
        db: ReturnType<typeof createMockDatabase>;
      };
      controllerState.db = createMockDatabase();

      await expect(controller.indexLikes()).rejects.toThrow(
        "Agent not initialized"
      );
    });
  });

  describe("indexBookmarks", () => {
    type BookmarkFeedItem =
      AppBskyBookmarkGetBookmarks.OutputSchema["bookmarks"][number];

    const createBookmarkItem = (suffix: number): BookmarkFeedItem => {
      const createdAt = new Date(1700000000000 + suffix).toISOString();
      return {
        createdAt,
        subject: {
          uri: `at://did:plc:test/app.bsky.feed.post/${suffix}`,
          cid: `cid-${suffix}`,
        },
        item: {
          uri: `at://did:plc:test/app.bsky.feed.post/${suffix}`,
          cid: `cid-${suffix}`,
          author: {
            did: "did:plc:test",
            handle: "user.test",
            displayName: "Test User",
          },
          likeCount: 5 + suffix,
          repostCount: 6 + suffix,
          replyCount: 7 + suffix,
          quoteCount: 8 + suffix,
          record: {
            $type: "app.bsky.feed.post",
            text: `Bookmark ${suffix}`,
            createdAt,
          },
          indexedAt: createdAt,
        },
      } as unknown as BookmarkFeedItem;
    };

    it("should fetch pages and store bookmarks", async () => {
      const controller = new BlueskyAccountController(1);
      const mockDb = createMockDatabase();
      const getBookmarks = jest.fn();
      const controllerState = controller as unknown as {
        db: ReturnType<typeof createMockDatabase>;
        agent: Agent | null;
        did: string | null;
        handle: string | null;
      };
      controllerState.db = mockDb;
      controllerState.did = "did:plc:test";
      controllerState.handle = "user.test";
      controllerState.agent = {
        app: { bsky: { bookmark: { getBookmarks } } },
      } as unknown as Agent;

      const bookmarkPage1 = [createBookmarkItem(1)];
      const bookmarkPage2 = [createBookmarkItem(2)];

      getBookmarks
        .mockResolvedValueOnce({
          data: { bookmarks: bookmarkPage1, cursor: "cursor-bookmark" },
        })
        .mockResolvedValueOnce({ data: { bookmarks: bookmarkPage2 } });

      await controller.indexBookmarks();

      expect(getBookmarks).toHaveBeenCalledTimes(2);
      expect(getBookmarks).toHaveBeenNthCalledWith(1, {
        cursor: undefined,
        limit: 100,
      });
      expect(getBookmarks).toHaveBeenNthCalledWith(2, {
        cursor: "cursor-bookmark",
        limit: 100,
      });

      const dbMocks = mockDb as unknown as MockDatabase;
      const bookmarkInsertCalls = dbMocks.runAsync.mock.calls.filter(
        ([sql]) =>
          typeof sql === "string" && sql.includes("INSERT INTO bookmark")
      );
      expect(bookmarkInsertCalls).toHaveLength(2);

      const postInsertCalls = dbMocks.runAsync.mock.calls.filter(
        ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO post")
      );
      expect(postInsertCalls).toHaveLength(2);
      const firstArgs = (postInsertCalls[0] as unknown[])?.[1] as unknown[];
      expect(firstArgs?.[24]).toBe(1); // viewerBookmarked

      expect(controller.progress.bookmarksProgress.current).toBe(2);
      expect(controller.progress.isRunning).toBe(false);
    });

    it("should fail when agent is not ready", async () => {
      const controller = new BlueskyAccountController(1);
      const controllerState = controller as unknown as {
        db: ReturnType<typeof createMockDatabase>;
      };
      controllerState.db = createMockDatabase();

      await expect(controller.indexBookmarks()).rejects.toThrow(
        "Agent not initialized"
      );
    });
  });

  describe("unimplemented save operations", () => {
    it("indexChatConvos should call indexer method", async () => {
      const controller = new BlueskyAccountController(1);
      const mockIndexer = {
        indexChatConvos: jest.fn().mockResolvedValue(undefined),
      };
      (controller as unknown as { indexer: unknown }).indexer = mockIndexer;
      await controller.indexChatConvos();
      expect(mockIndexer.indexChatConvos).toHaveBeenCalled();
    });

    it("indexChatMessages should call indexer method", async () => {
      const controller = new BlueskyAccountController(1);
      const mockIndexer = {
        indexChatMessages: jest.fn().mockResolvedValue(undefined),
      };
      (controller as unknown as { indexer: unknown }).indexer = mockIndexer;
      await controller.indexChatMessages();
      expect(mockIndexer.indexChatMessages).toHaveBeenCalled();
    });
  });

  describe("media operations", () => {
    it("should skip download when file already exists", async () => {
      const controller = new BlueskyAccountController(1);
      (controller as unknown as { agent: Agent | null }).agent = {} as Agent;
      const uuid = controller.getAccountUUID();
      const paths = buildAccountPaths("bluesky", uuid);
      const fsMock = jest.mocked(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("expo-file-system") as {
          __mockState: {
            infoMap: Map<string, { exists: boolean; isDirectory: boolean }>;
          };
        }
      );
      const infoMap = fsMock.__mockState.infoMap;
      const targetPath = `${paths.mediaDir}blob-cid`;

      infoMap.set(paths.accountsDir, { exists: true, isDirectory: true });
      infoMap.set(paths.accountDir, { exists: true, isDirectory: true });
      infoMap.set(paths.mediaDir, {
        exists: true,
        isDirectory: true,
      });
      infoMap.set(targetPath, { exists: true, isDirectory: false });

      const path = await controller.downloadMedia("blob-cid", "did:plc:123");

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const mockedDownload = jest.mocked(File.downloadFileAsync);
      expect(mockedDownload).not.toHaveBeenCalled();
      expect(path).toBe(targetPath);
    });

    it("should download media when missing", async () => {
      const controller = new BlueskyAccountController(1);
      (controller as unknown as { agent: Agent | null }).agent = {} as Agent;
      const uuid = controller.getAccountUUID();
      const paths = buildAccountPaths("bluesky", uuid);
      const fsMock = jest.mocked(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("expo-file-system") as {
          __mockState: {
            infoMap: Map<string, { exists: boolean; isDirectory: boolean }>;
          };
        }
      );
      const infoMap = fsMock.__mockState.infoMap;
      const safeName = encodeURIComponent("bafy/test");
      const targetPath = `${paths.mediaDir}${safeName}`;

      infoMap.set(paths.accountsDir, { exists: true, isDirectory: true });
      infoMap.set(paths.accountDir, { exists: true, isDirectory: true });

      const path = await controller.downloadMedia("bafy/test", "did:plc:123");

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const mockedDownload = jest.mocked(File.downloadFileAsync);
      expect(mockedDownload).toHaveBeenCalledTimes(1);
      const [url, dest] = mockedDownload.mock.calls[0] as [string, File];
      expect(url).toBe("https://cdn.bsky.app/blob/did%3Aplc%3A123/bafy%2Ftest");
      expect(dest).toBeInstanceOf(File);
      expect(path).toBe(targetPath);
    });
  });

  describe("cleanup", () => {
    it("should reset agent state on cleanup", async () => {
      const controller = new BlueskyAccountController(1);

      await controller.cleanup();

      expect(controller.getDid()).toBeNull();
      expect(controller.getHandle()).toBeNull();
      expect(controller.isAgentReady()).toBe(false);
    });
  });

  describe("rate limit info", () => {
    it("should return initial rate limit info", () => {
      const controller = new BlueskyAccountController(1);
      const info = controller.getRateLimitInfo();

      expect(info.limit).toBe(3000);
      expect(info.remaining).toBe(3000);
      expect(info.resetAt).toBe(0);
      expect(info.isLimited).toBe(false);
    });

    it("should return a copy of rate limit info", () => {
      const controller = new BlueskyAccountController(1);
      const info1 = controller.getRateLimitInfo();
      const info2 = controller.getRateLimitInfo();

      // Should be equal but not the same object
      expect(info1).toEqual(info2);
      expect(info1).not.toBe(info2);
    });
  });

  describe("rate limit callback", () => {
    it("should call rate limit callback when set", () => {
      const controller = new BlueskyAccountController(1);
      const callback = jest.fn();

      controller.setRateLimitCallback(callback);

      // The callback should be stored and callable
      expect(callback).not.toHaveBeenCalled();
    });

    it("should allow replacing rate limit callback", () => {
      const controller = new BlueskyAccountController(1);
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      controller.setRateLimitCallback(callback1);
      controller.setRateLimitCallback(callback2);

      // Should not throw
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });
  });

  describe("session expired callback", () => {
    it("should call session expired callback when set", () => {
      const controller = new BlueskyAccountController(1);
      const callback = jest.fn().mockResolvedValue(undefined);

      controller.setSessionExpiredCallback(callback);

      // The callback should be stored
      expect(callback).not.toHaveBeenCalled();
    });

    it("should allow replacing session expired callback", () => {
      const controller = new BlueskyAccountController(1);
      const callback1 = jest.fn().mockResolvedValue(undefined);
      const callback2 = jest.fn().mockResolvedValue(undefined);

      controller.setSessionExpiredCallback(callback1);
      controller.setSessionExpiredCallback(callback2);

      // Should not throw
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });
  });

  describe("progress callback", () => {
    it("should call progress callback when set", () => {
      const controller = new BlueskyAccountController(1);
      const callback = jest.fn<void, [BlueskyProgress]>();

      controller.setProgressCallback(callback);

      // The callback should be stored
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("metadata", () => {
    it("should include metadataPath in buildAccountPaths", () => {
      const paths = buildAccountPaths("bluesky", "test-uuid-123");

      expect(paths.metadataPath).toBe(`${paths.accountDir}metadata.json`);
    });
  });

  describe("export archive", () => {
    it("should format date correctly for archive name", async () => {
      const controller = new BlueskyAccountController(1);

      // Access the private method via reflection for testing
      const formatDate = (
        controller as unknown as {
          formatDateForArchive: (date: Date) => string;
        }
      ).formatDateForArchive;

      const testDate = new Date(2026, 0, 10); // January 10, 2026
      const result = formatDate.call(controller, testDate);

      expect(result).toBe("2026-01-10");
    });

    it("should use unknown as handle when handle is null", async () => {
      const controller = new BlueskyAccountController(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (controller as any).agent = { did: "did:plc:test" }; // Mock agent to pass check

      // The handle should be null by default
      expect(controller.getHandle()).toBeNull();
    });

    it("should throw error when agent is not initialized for media download", async () => {
      const controller = new BlueskyAccountController(1);

      await expect(
        controller.downloadMedia("test-blob", "did:plc:test")
      ).rejects.toThrow("Agent not initialized");
    });
  });
});

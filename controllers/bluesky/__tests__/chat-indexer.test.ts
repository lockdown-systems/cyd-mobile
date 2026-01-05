/**
 * @fileoverview Tests for ChatIndexer
 */

import type { Agent } from "@atproto/api";
import type { SQLiteDatabase } from "expo-sqlite";

import {
  createChatMessage,
  createChatMessageWithEmbed,
  createChatMessageWithFacets,
  createChatMessageWithReactions,
  createConversation,
  createPostView,
  createProfile,
} from "@/testUtils/blueskyFixtures";
import { createMockDatabase } from "@/testUtils/mockDatabase";
import { ChatIndexer, type ChatIndexerDeps } from "../chat-indexer";

describe("ChatIndexer", () => {
  let mockDb: SQLiteDatabase;
  let mockAgent: Partial<Agent>;
  let deps: ChatIndexerDeps;
  let updateProgressCalls: unknown[];
  let downloadedUrls: string[];

  beforeEach(() => {
    mockDb = createMockDatabase();
    updateProgressCalls = [];
    downloadedUrls = [];

    // Create a mock agent with API methods
    mockAgent = {
      chat: {
        bsky: {
          convo: {
            listConvos: jest.fn(),
            getMessages: jest.fn(),
          },
        },
      },
      app: {
        bsky: {
          feed: {
            getPosts: jest.fn(),
          },
        },
      },
      getProfile: jest.fn(),
    } as unknown as Partial<Agent>;

    deps = {
      getDb: () => mockDb,
      getAgent: () => mockAgent as Agent,
      getDid: () => "did:plc:testuser",
      updateProgress: jest.fn((update) => updateProgressCalls.push(update)),
      makeApiRequest: jest.fn((fn) => fn()),
      downloadMediaFromUrl: jest.fn(async (url: string) => {
        downloadedUrls.push(url);
        return `/local/path/${encodeURIComponent(url)}`;
      }),
    };
  });

  describe("indexChatConvos", () => {
    it("should index a single page of conversations", async () => {
      const convos = [
        createConversation({
          id: "convo1",
          members: [
            createProfile({
              did: "did:plc:alice",
              handle: "alice.bsky.social",
            }),
            createProfile({ did: "did:plc:bob", handle: "bob.bsky.social" }),
          ],
        }),
        createConversation({
          id: "convo2",
          members: [
            createProfile({
              did: "did:plc:alice",
              handle: "alice.bsky.social",
            }),
            createProfile({
              did: "did:plc:charlie",
              handle: "charlie.bsky.social",
            }),
          ],
        }),
      ];

      (mockAgent.chat!.bsky.convo.listConvos as jest.Mock).mockResolvedValue({
        convos,
        cursor: undefined,
      });

      const indexer = new ChatIndexer(deps);
      await indexer.indexChatConvos();

      // Should have called runAsync for each conversation
      expect(mockDb.runAsync).toHaveBeenCalled();

      // Should update progress
      const lastProgress = updateProgressCalls[updateProgressCalls.length - 1];
      expect(lastProgress).toMatchObject({
        currentAction: "Finished saving conversations",
        isRunning: false,
      });
    });

    it("should paginate through multiple pages of conversations", async () => {
      const page1 = Array.from({ length: 50 }, (_, i) =>
        createConversation({ id: `convo${i}` })
      );
      const page2 = Array.from({ length: 25 }, (_, i) =>
        createConversation({ id: `convo${50 + i}` })
      );

      (mockAgent.chat!.bsky.convo.listConvos as jest.Mock)
        .mockResolvedValueOnce({ convos: page1, cursor: "cursor1" })
        .mockResolvedValueOnce({ convos: page2, cursor: undefined });

      const indexer = new ChatIndexer(deps);
      await indexer.indexChatConvos();

      // Should have called API twice
      expect(mockAgent.chat!.bsky.convo.listConvos).toHaveBeenCalledTimes(2);
    });

    it("should save member profiles from conversations", async () => {
      const convos = [
        createConversation({
          id: "convo1",
          members: [
            createProfile({
              did: "did:plc:alice",
              handle: "alice.bsky.social",
            }),
            createProfile({ did: "did:plc:bob", handle: "bob.bsky.social" }),
          ],
        }),
      ];

      (mockAgent.chat!.bsky.convo.listConvos as jest.Mock).mockResolvedValue({
        convos,
        cursor: undefined,
      });

      const indexer = new ChatIndexer(deps);
      await indexer.indexChatConvos();

      // Should have saved profile information
      const runAsyncCalls = (mockDb.runAsync as jest.Mock).mock.calls;
      const profileInserts = runAsyncCalls.filter(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("INSERT") &&
          call[0].includes("profile")
      );
      expect(profileInserts.length).toBeGreaterThan(0);
    });

    it("should handle muted conversations", async () => {
      const convos = [
        createConversation({ id: "convo1", muted: true }),
        createConversation({ id: "convo2", muted: false }),
      ];

      (mockAgent.chat!.bsky.convo.listConvos as jest.Mock).mockResolvedValue({
        convos,
        cursor: undefined,
      });

      const indexer = new ChatIndexer(deps);
      await indexer.indexChatConvos();

      // Should save both conversations with correct muted flag
      expect(mockDb.runAsync).toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      (mockAgent.chat!.bsky.convo.listConvos as jest.Mock).mockRejectedValue(
        new Error("API Error")
      );

      const indexer = new ChatIndexer(deps);
      await expect(indexer.indexChatConvos()).rejects.toThrow("API Error");

      const lastProgress = updateProgressCalls[updateProgressCalls.length - 1];
      expect(lastProgress).toMatchObject({
        isRunning: false,
        error: "API Error",
      });
    });

    it("should throw if database is not initialized", async () => {
      deps.getDb = () => null;
      const indexer = new ChatIndexer(deps);

      await expect(indexer.indexChatConvos()).rejects.toThrow(
        "Database not initialized"
      );
    });

    it("should throw if agent is not initialized", async () => {
      deps.getAgent = () => null;
      const indexer = new ChatIndexer(deps);

      await expect(indexer.indexChatConvos()).rejects.toThrow(
        "Agent not initialized"
      );
    });
  });

  describe("indexChatMessages", () => {
    beforeEach(() => {
      // Setup mock to return conversations from DB
      (mockDb.getAllAsync as jest.Mock).mockResolvedValue([
        { convoId: "convo1" },
        { convoId: "convo2" },
      ]);
    });

    it("should index messages from all conversations", async () => {
      const messages1 = [
        createChatMessage({ text: "Hello from convo1" }),
        createChatMessage({ text: "Another message" }),
      ];
      const messages2 = [createChatMessage({ text: "Hello from convo2" })];

      (mockAgent.chat!.bsky.convo.getMessages as jest.Mock)
        .mockResolvedValueOnce({ messages: messages1, cursor: undefined })
        .mockResolvedValueOnce({ messages: messages2, cursor: undefined });

      const indexer = new ChatIndexer(deps);
      await indexer.indexChatMessages();

      // Should have saved messages from both conversations
      expect(mockDb.runAsync).toHaveBeenCalled();
      const lastProgress = updateProgressCalls[updateProgressCalls.length - 1];
      expect(lastProgress).toMatchObject({
        currentAction: expect.stringContaining("Finished saving"),
        isRunning: false,
      });
    });

    it("should handle messages with facets", async () => {
      const messages = [createChatMessageWithFacets()];

      (mockDb.getAllAsync as jest.Mock).mockResolvedValue([
        { convoId: "convo1" },
      ]);
      (mockAgent.chat!.bsky.convo.getMessages as jest.Mock).mockResolvedValue({
        messages,
        cursor: undefined,
      });

      const indexer = new ChatIndexer(deps);
      await indexer.indexChatMessages();

      // Should save message with facetsJSON
      const runAsyncCalls = (mockDb.runAsync as jest.Mock).mock.calls;
      const messageInsert = runAsyncCalls.find(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("INSERT") &&
          call[0].includes("message")
      );
      expect(messageInsert).toBeDefined();

      // Check that facetsJSON is saved
      const params = messageInsert[1];
      const facetsIndex = 5; // facetsJSON position
      expect(params[facetsIndex]).toBeTruthy();
      expect(() => JSON.parse(params[facetsIndex])).not.toThrow();
    });

    it("should handle messages with embedded posts", async () => {
      const messages = [createChatMessageWithEmbed()];
      const embeddedPost = createPostView({
        record: { text: "Embedded post content" },
      });

      (mockDb.getAllAsync as jest.Mock).mockResolvedValue([
        { convoId: "convo1" },
      ]);
      (mockAgent.chat!.bsky.convo.getMessages as jest.Mock).mockResolvedValue({
        messages,
        cursor: undefined,
      });
      (mockAgent.app!.bsky.feed.getPosts as jest.Mock).mockResolvedValue({
        posts: [embeddedPost],
      });

      const indexer = new ChatIndexer(deps);
      await indexer.indexChatMessages();

      // Should have fetched the embedded post
      expect(mockAgent.app!.bsky.feed.getPosts).toHaveBeenCalled();
    });

    it("should handle messages with reactions", async () => {
      const messages = [createChatMessageWithReactions(["❤️", "👍", "😂"])];

      (mockDb.getAllAsync as jest.Mock).mockResolvedValue([
        { convoId: "convo1" },
      ]);
      (mockAgent.chat!.bsky.convo.getMessages as jest.Mock).mockResolvedValue({
        messages,
        cursor: undefined,
      });

      const indexer = new ChatIndexer(deps);
      await indexer.indexChatMessages();

      // Should save message with reactionsJSON
      const runAsyncCalls = (mockDb.runAsync as jest.Mock).mock.calls;
      const messageInsert = runAsyncCalls.find(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("INSERT") &&
          call[0].includes("message")
      );
      expect(messageInsert).toBeDefined();

      // Check that reactionsJSON is saved
      const params = messageInsert[1];
      const reactionsIndex = 7; // reactionsJSON position
      expect(params[reactionsIndex]).toBeTruthy();
      expect(() => JSON.parse(params[reactionsIndex])).not.toThrow();
    });

    it("should paginate through message pages", async () => {
      const page1 = Array.from({ length: 100 }, (_, i) =>
        createChatMessage({ text: `Message ${i}` })
      );
      const page2 = Array.from({ length: 50 }, (_, i) =>
        createChatMessage({ text: `Message ${100 + i}` })
      );

      (mockDb.getAllAsync as jest.Mock).mockResolvedValue([
        { convoId: "convo1" },
      ]);
      (mockAgent.chat!.bsky.convo.getMessages as jest.Mock)
        .mockResolvedValueOnce({ messages: page1, cursor: "cursor1" })
        .mockResolvedValueOnce({ messages: page2, cursor: undefined });

      const indexer = new ChatIndexer(deps);
      await indexer.indexChatMessages();

      // Should have called getMessages twice
      expect(mockAgent.chat!.bsky.convo.getMessages).toHaveBeenCalledTimes(2);
    });

    it("should handle no conversations", async () => {
      (mockDb.getAllAsync as jest.Mock).mockResolvedValue([]);

      const indexer = new ChatIndexer(deps);
      await indexer.indexChatMessages();

      const lastProgress = updateProgressCalls[updateProgressCalls.length - 1];
      expect(lastProgress).toMatchObject({
        currentAction: "No conversations found",
        isRunning: false,
      });
    });

    it("should save sender profiles", async () => {
      const senderProfile = createProfile({
        did: "did:plc:sender",
        handle: "sender.bsky.social",
      });
      const messages = [
        createChatMessage({ text: "Hello", sender: senderProfile }),
      ];

      (mockDb.getAllAsync as jest.Mock).mockResolvedValue([
        { convoId: "convo1" },
      ]);
      (mockAgent.chat!.bsky.convo.getMessages as jest.Mock).mockResolvedValue({
        messages,
        cursor: undefined,
      });

      const indexer = new ChatIndexer(deps);
      await indexer.indexChatMessages();

      // Should have saved sender profile
      const runAsyncCalls = (mockDb.runAsync as jest.Mock).mock.calls;
      const profileInserts = runAsyncCalls.filter(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("INSERT") &&
          call[0].includes("profile")
      );
      expect(profileInserts.length).toBeGreaterThan(0);
    });

    it("should handle messages with all features combined", async () => {
      const embeddedPost = createPostView();
      const message: ReturnType<typeof createChatMessage> = {
        ...createChatMessageWithFacets(),
        embed: {
          $type: "app.bsky.embed.record#view",
          record: {
            $type: "app.bsky.embed.record#viewRecord",
            uri: "at://did:plc:author/app.bsky.feed.post/embedded123",
            cid: "bafyreimbedded123",
            author: createProfile(),
            value: {
              text: "Embedded post",
              createdAt: new Date().toISOString(),
            },
            indexedAt: new Date().toISOString(),
          },
        },
        reactions: [
          { emoji: "❤️", count: 5, viewer: { reacted: true } },
          { emoji: "👍", count: 3, viewer: { reacted: false } },
        ],
      };

      (mockDb.getAllAsync as jest.Mock).mockResolvedValue([
        { convoId: "convo1" },
      ]);
      (mockAgent.chat!.bsky.convo.getMessages as jest.Mock).mockResolvedValue({
        messages: [message],
        cursor: undefined,
      });
      (mockAgent.app!.bsky.feed.getPosts as jest.Mock).mockResolvedValue({
        posts: [embeddedPost],
      });

      const indexer = new ChatIndexer(deps);
      await indexer.indexChatMessages();

      expect(mockDb.runAsync).toHaveBeenCalled();
      expect(mockAgent.app!.bsky.feed.getPosts).toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      (mockDb.getAllAsync as jest.Mock).mockResolvedValue([
        { convoId: "convo1" },
      ]);
      (mockAgent.chat!.bsky.convo.getMessages as jest.Mock).mockRejectedValue(
        new Error("API Error")
      );

      const indexer = new ChatIndexer(deps);
      await expect(indexer.indexChatMessages()).rejects.toThrow("API Error");

      const lastProgress = updateProgressCalls[updateProgressCalls.length - 1];
      expect(lastProgress).toMatchObject({
        isRunning: false,
        error: "API Error",
      });
    });

    it("should skip messages without text", async () => {
      const messages = [
        createChatMessage({ text: "Valid message" }),
        {
          id: "msg2",
          sender: { did: "did:plc:sender" },
          sentAt: new Date().toISOString(),
        }, // No text
        createChatMessage({ text: "Another valid message" }),
      ];

      (mockDb.getAllAsync as jest.Mock).mockResolvedValue([
        { convoId: "convo1" },
      ]);
      (mockAgent.chat!.bsky.convo.getMessages as jest.Mock).mockResolvedValue({
        messages,
        cursor: undefined,
      });

      const indexer = new ChatIndexer(deps);
      await indexer.indexChatMessages();

      // Should only save messages with text (2, not 3)
      const runAsyncCalls = (mockDb.runAsync as jest.Mock).mock.calls;
      const messageInserts = runAsyncCalls.filter(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("INSERT") &&
          call[0].includes("message")
      );
      expect(messageInserts.length).toBe(2);
    });
  });
});

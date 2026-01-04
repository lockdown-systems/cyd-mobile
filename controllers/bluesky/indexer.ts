import { Agent } from "@atproto/api";
import type { SQLiteDatabase } from "expo-sqlite";

import { ChatIndexer, type ChatIndexerDeps } from "./chat-indexer";
import { PostIndexer, type PostIndexerDeps } from "./post-indexer";
import type { ApiRequestFn } from "./rate-limiter";
import type { BlueskyProgress } from "./types";

type RequestExecutor = <T>(requestFn: ApiRequestFn<T>) => Promise<T>;

interface IndexerDeps {
  getDb: () => SQLiteDatabase | null;
  getAgent: () => Agent | null;
  getDid: () => string | null;
  updateProgress: (updates: Partial<BlueskyProgress>) => void;
  waitForPause: () => Promise<void>;
  makeApiRequest: RequestExecutor;
  downloadMediaFromUrl: (url: string, did: string) => Promise<string>;
}

export class BlueskyIndexer {
  private readonly postIndexer: PostIndexer;
  private readonly chatIndexer: ChatIndexer;

  constructor(private readonly deps: IndexerDeps) {
    const postIndexerDeps: PostIndexerDeps = {
      getDb: deps.getDb,
      getAgent: deps.getAgent,
      getDid: deps.getDid,
      updateProgress: deps.updateProgress,
      waitForPause: deps.waitForPause,
      makeApiRequest: deps.makeApiRequest,
      downloadMediaFromUrl: deps.downloadMediaFromUrl,
    };

    const chatIndexerDeps: ChatIndexerDeps = {
      getDb: deps.getDb,
      getAgent: deps.getAgent,
      getDid: deps.getDid,
      updateProgress: deps.updateProgress,
      makeApiRequest: deps.makeApiRequest,
      downloadMediaFromUrl: deps.downloadMediaFromUrl,
    };

    this.postIndexer = new PostIndexer(postIndexerDeps);
    this.chatIndexer = new ChatIndexer(chatIndexerDeps);
  }

  async indexPosts(): Promise<void> {
    return this.postIndexer.indexPosts();
  }

  async indexLikes(): Promise<void> {
    return this.postIndexer.indexLikes();
  }

  async indexBookmarks(): Promise<void> {
    return this.postIndexer.indexBookmarks();
  }

  async indexChatConvos(): Promise<void> {
    return this.chatIndexer.indexChatConvos();
  }

  async indexChatMessages(): Promise<void> {
    return this.chatIndexer.indexChatMessages();
  }
}

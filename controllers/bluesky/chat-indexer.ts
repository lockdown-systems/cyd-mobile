import {
  Agent,
  type AppBskyActorDefs,
  type ChatBskyConvoGetMessages,
  type ChatBskyConvoListConvos,
} from "@atproto/api";
import type { SQLiteDatabase } from "expo-sqlite";
import { PostPersistence } from "./post-persistence";
import type { ApiRequestFn } from "./rate-limiter";
import type {
  BlueskyProgress,
  ConversationPreviewData,
  MessagePreviewData,
  ProfileData,
} from "./types";

type RequestExecutor = <T>(requestFn: ApiRequestFn<T>) => Promise<T>;

/**
 * Headers required for the Bluesky Chat DM service proxy
 */
const DM_SERVICE_HEADERS = {
  "atproto-proxy": "did:web:api.bsky.chat#bsky_chat",
};

export interface ChatIndexerDeps {
  getDb: () => SQLiteDatabase | null;
  getAgent: () => Agent | null;
  getDid: () => string | null;
  updateProgress: (updates: Partial<BlueskyProgress>) => void;
  makeApiRequest: RequestExecutor;
  downloadMediaFromUrl: (url: string, did: string) => Promise<string>;
}

/**
 * Handles indexing of chat conversations and messages from Bluesky
 */
export class ChatIndexer {
  private readonly postPersistence: PostPersistence;

  constructor(private readonly deps: ChatIndexerDeps) {
    this.postPersistence = new PostPersistence({
      downloadMediaFromUrl: deps.downloadMediaFromUrl,
      getDid: deps.getDid,
    });
  }

  async indexChatConvos(): Promise<void> {
    const db = this.requireDb();
    const agent = this.requireAgent();

    this.deps.updateProgress({
      currentAction: "Saving chat conversations...",
      isRunning: true,
      error: null,
    });

    let cursor: string | undefined;
    let totalSaved = 0;

    try {
      while (true) {
        const response = await this.deps.makeApiRequest(() =>
          agent.chat.bsky.convo.listConvos(
            {
              cursor,
              limit: 50,
            },
            { headers: DM_SERVICE_HEADERS }
          )
        );

        const convos = response.convos ?? [];
        const nextCursor = response.cursor;

        if (convos.length > 0) {
          await this.saveConversations(db, convos, (convo) => {
            totalSaved++;
            const previewData = this.buildConversationPreview(convo);
            this.deps.updateProgress({
              currentAction: `Saved ${totalSaved} conversations`,
              previewData: previewData
                ? { type: "conversation", data: previewData }
                : undefined,
            });
          });
        }

        if (!nextCursor || convos.length === 0) {
          break;
        }

        cursor = nextCursor;
      }

      this.deps.updateProgress({
        currentAction: "Finished saving conversations",
        isRunning: false,
        previewData: null,
      });
    } catch (error) {
      this.deps.updateProgress({
        isRunning: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  async indexChatMessages(): Promise<void> {
    const db = this.requireDb();
    const agent = this.requireAgent();

    this.deps.updateProgress({
      currentAction: "Loading conversations...",
      isRunning: true,
      error: null,
    });

    try {
      // Get all conversation IDs from the database
      const convos = await db.getAllAsync<{ convoId: string }>(
        `SELECT convoId FROM conversation ORDER BY updatedAt DESC`
      );

      if (convos.length === 0) {
        this.deps.updateProgress({
          currentAction: "No conversations found",
          isRunning: false,
        });
        return;
      }

      let totalSaved = 0;
      let convoIndex = 0;

      for (const { convoId } of convos) {
        convoIndex++;
        let cursor: string | undefined;

        this.deps.updateProgress({
          currentAction: `Saving messages from conversation ${convoIndex}/${convos.length}...`,
        });

        while (true) {
          const response = await this.deps.makeApiRequest(() =>
            agent.chat.bsky.convo.getMessages(
              {
                convoId,
                cursor,
                limit: 100,
              },
              { headers: DM_SERVICE_HEADERS }
            )
          );

          const messages = response.messages ?? [];
          const nextCursor = response.cursor;

          if (messages.length > 0) {
            await this.saveMessages(db, convoId, messages, async (message) => {
              totalSaved++;
              const previewData = await this.buildMessagePreview(
                db,
                convoId,
                message
              );
              this.deps.updateProgress({
                currentAction: `Saved ${totalSaved} messages (${convoIndex}/${convos.length} conversations)`,
                previewData: previewData
                  ? { type: "message", data: previewData }
                  : undefined,
              });
            });
          }

          if (!nextCursor || messages.length === 0) {
            break;
          }

          cursor = nextCursor;
        }
      }

      this.deps.updateProgress({
        currentAction: `Finished saving ${totalSaved} messages`,
        isRunning: false,
        previewData: null,
      });
    } catch (error) {
      this.deps.updateProgress({
        isRunning: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  private async saveConversations(
    db: SQLiteDatabase,
    convos: ChatBskyConvoListConvos.OutputSchema["convos"],
    onConvoSaved?: (
      convo: ChatBskyConvoListConvos.OutputSchema["convos"][0]
    ) => void
  ): Promise<number> {
    let savedCount = 0;
    const now = Date.now();

    for (const convo of convos) {
      // Extract member DIDs as JSON array
      const memberDids = JSON.stringify(convo.members?.map((m) => m.did) ?? []);

      // Extract last message data safely
      const lastMsg = convo.lastMessage as
        | {
            id?: string;
            text?: string;
            sentAt?: string;
            sender?: { did?: string };
          }
        | undefined;

      await db.runAsync(
        `INSERT OR REPLACE INTO conversation (
          convoId, rev, memberDids, muted, status, unreadCount,
          lastMessageId, lastMessageText, lastMessageSentAt, lastMessageSenderDid,
          savedAt, updatedAt, leftAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          convo.id,
          convo.rev ?? null,
          memberDids,
          convo.muted ? 1 : 0,
          (convo as { status?: string }).status ?? null,
          convo.unreadCount ?? 0,
          lastMsg?.id ?? null,
          lastMsg?.text ?? null,
          lastMsg?.sentAt ?? null,
          lastMsg?.sender?.did ?? null,
          now,
          lastMsg?.sentAt ? new Date(lastMsg.sentAt).getTime() : now,
          null,
        ]
      );

      // Save profile information for each member
      for (const member of convo.members ?? []) {
        const memberProfile =
          member as unknown as AppBskyActorDefs.ProfileViewBasic;
        if (memberProfile.handle) {
          // Member has full profile data
          await this.postPersistence.upsertProfile(db, memberProfile);
        } else if (memberProfile.did) {
          // Member only has DID, check if we need to fetch profile
          const existingProfile = await db.getFirstAsync<{ did: string }>(
            `SELECT did FROM profile WHERE did = ?`,
            [memberProfile.did]
          );

          if (!existingProfile) {
            // Fetch profile from API
            try {
              const agent = this.requireAgent();
              const profileResponse = await this.deps.makeApiRequest(() =>
                agent.getProfile({ actor: memberProfile.did })
              );
              await this.postPersistence.upsertProfile(
                db,
                profileResponse as AppBskyActorDefs.ProfileViewBasic
              );
            } catch (error) {
              console.warn(
                `[ChatIndexer] Failed to fetch profile for member ${memberProfile.did}`,
                error
              );
            }
          }
        }
      }

      // Notify caller that conversation was saved
      if (onConvoSaved) {
        onConvoSaved(convo);
      }

      savedCount++;
    }

    return savedCount;
  }

  private async saveMessages(
    db: SQLiteDatabase,
    convoId: string,
    messages: ChatBskyConvoGetMessages.OutputSchema["messages"],
    onMessageSaved?: (
      message: ChatBskyConvoGetMessages.OutputSchema["messages"][0]
    ) => Promise<void>
  ): Promise<number> {
    let savedCount = 0;
    const now = Date.now();

    for (const message of messages) {
      // Type guard and extract message data
      const msg = message as
        | {
            id?: string;
            rev?: string;
            text?: string;
            sentAt?: string;
            sender?: { did?: string };
            facets?: unknown[];
            embed?: unknown;
            reactions?: unknown[];
          }
        | undefined;

      // Only process messages that have text content
      if (!msg?.text) {
        continue;
      }

      const embeddedInfo = this.extractEmbeddedRecordInfo(msg.embed);

      await db.runAsync(
        `INSERT OR REPLACE INTO message (
          messageId, convoId, rev, senderDid, text, facetsJSON, embedJSON, reactionsJSON, embeddedPostUri, embeddedPostCid, sentAt, savedAt, deletedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          msg.id ?? null,
          convoId,
          msg.rev ?? null,
          msg.sender?.did ?? null,
          msg.text,
          msg.facets ? JSON.stringify(msg.facets) : null,
          msg.embed ? JSON.stringify(msg.embed) : null,
          msg.reactions ? JSON.stringify(msg.reactions) : null,
          embeddedInfo?.uri ?? null,
          embeddedInfo?.cid ?? null,
          msg.sentAt ?? null,
          now,
          null,
        ]
      );

      // If the message embeds a post, fetch the full post view (counts + media) and persist it
      if (embeddedInfo?.uri) {
        await this.persistEmbeddedRecord(db, embeddedInfo.uri);
      }

      // Save sender profile. If the sender object includes handle, save it directly.
      // Otherwise, check if we have the profile in DB; if not, fetch from API.
      const senderWithProfile = msg.sender as AppBskyActorDefs.ProfileViewBasic;
      if (senderWithProfile?.did) {
        if (senderWithProfile.handle) {
          // Sender object includes profile info, save it directly
          await this.postPersistence.upsertProfile(db, senderWithProfile);
        } else {
          // Sender only has DID. Check if we already have the profile.
          const existingProfile = await db.getFirstAsync<{ did: string }>(
            `SELECT did FROM profile WHERE did = ?`,
            [senderWithProfile.did]
          );

          if (!existingProfile) {
            // Fetch profile from API
            try {
              const agent = this.requireAgent();
              const profileResponse = await this.deps.makeApiRequest(() =>
                agent.getProfile({ actor: senderWithProfile.did })
              );

              await this.postPersistence.upsertProfile(
                db,
                profileResponse as AppBskyActorDefs.ProfileViewBasic
              );
            } catch (error) {
              // Log but don't fail the whole job if profile fetch fails
              console.warn(
                `[ChatIndexer] Failed to fetch profile for ${senderWithProfile.did}`,
                error
              );
            }
          }
        }
      }

      savedCount++;

      // Notify caller that message was saved
      if (onMessageSaved) {
        await onMessageSaved(message);
      }
    }

    return savedCount;
  }

  /**
   * Persist an embedded record (post) found inside a chat message embed
   */
  private extractEmbeddedRecordInfo(
    embed: unknown
  ): { uri?: string; cid?: string } | null {
    if (!embed || typeof embed !== "object") return null;
    const embedObj = embed as Record<string, unknown>;
    const record = embedObj.record as Record<string, unknown> | undefined;
    if (record && typeof record.uri === "string") {
      return {
        uri: record.uri,
        cid: typeof record.cid === "string" ? record.cid : undefined,
      };
    }
    return null;
  }

  private async persistEmbeddedRecord(
    db: SQLiteDatabase,
    uri: string
  ): Promise<void> {
    try {
      const agent = this.requireAgent();
      const response = await this.deps.makeApiRequest(() =>
        agent.app.bsky.feed.getPosts({ uris: [uri] })
      );

      const postView = response?.posts?.[0];
      if (postView) {
        await this.postPersistence.persistPostView(db, postView);
      }
    } catch (error) {
      console.warn("[ChatIndexer] Failed to persist embedded post", {
        uri,
        error,
      });
    }
  }

  private requireDb(): SQLiteDatabase {
    const db = this.deps.getDb();
    if (!db) {
      throw new Error("Database not initialized");
    }
    return db;
  }

  private requireAgent(): Agent {
    const agent = this.deps.getAgent();
    if (!agent) {
      throw new Error("Agent not initialized");
    }
    return agent;
  }

  /**
   * Build a conversation preview from a convo object
   */
  private buildConversationPreview(
    convo: ChatBskyConvoListConvos.OutputSchema["convos"][0]
  ): ConversationPreviewData | null {
    if (!convo) return null;

    const lastMsg = convo.lastMessage as
      | { text?: string; sentAt?: string }
      | undefined;

    const members: ProfileData[] = (convo.members ?? []).map((member) => ({
      did: member.did,
      handle: member.handle,
      displayName: member.displayName ?? null,
      avatarUrl: member.avatar ?? null,
    }));

    return {
      convoId: convo.id,
      lastMessageText: lastMsg?.text ?? null,
      lastMessageSentAt: lastMsg?.sentAt ?? null,
      unreadCount: convo.unreadCount ?? 0,
      muted: convo.muted ?? false,
      members,
    };
  }

  /**
   * Build a message preview from a message object
   */
  private async buildMessagePreview(
    db: SQLiteDatabase,
    convoId: string,
    message: ChatBskyConvoGetMessages.OutputSchema["messages"][0]
  ): Promise<MessagePreviewData | null> {
    const msg = message as
      | {
          id?: string;
          text?: string;
          sentAt?: string;
          sender?: {
            did?: string;
          };
          embed?: unknown;
          facets?: unknown[];
          reactions?: unknown[];
        }
      | undefined;

    if (!msg?.text || !msg?.id || !msg.sender?.did) return null;

    // Fetch the profile from the database
    const profile = await db.getFirstAsync<{
      did: string;
      handle: string;
      displayName: string | null;
      avatarUrl: string | null;
    }>(
      `SELECT did, handle, displayName, avatarUrl FROM profile WHERE did = ?`,
      [msg.sender.did]
    );

    const sender: ProfileData = {
      did: msg.sender.did,
      handle: profile?.handle ?? "unknown",
      displayName: profile?.displayName ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
    };

    return {
      messageId: msg.id,
      convoId,
      text: msg.text,
      sentAt: msg.sentAt ?? new Date().toISOString(),
      savedAt: new Date().toISOString(),
      deletedAt: null,
      sender,
      embed: (msg.embed as Record<string, unknown> | null) ?? null,
      facets: msg.facets ?? null,
      reactions: msg.reactions ?? null,
    };
  }
}

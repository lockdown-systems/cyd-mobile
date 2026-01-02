import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ConversationPreview } from "@/components/ConversationPreview";
import { MessagePreview } from "@/components/MessagePreview";
import type {
  AutomationConversationPreviewData,
  AutomationMessagePreviewData,
  AutomationProfileData,
} from "@/controllers/bluesky/types";
import type { AccountTabPalette } from "@/types/account-tabs";

import { BrowsePlaceholderCard } from "./BrowsePlaceholderCard";
import { fetchAccountMeta, openAccountDb } from "./shared";

type Props = {
  handle: string;
  palette: AccountTabPalette;
  accountId?: number;
};

type ConversationRow = {
  convoId: string;
  memberDids: string; // JSON array
  muted: number;
  status: string | null;
  unreadCount: number;
  lastMessageText: string | null;
  lastMessageSentAt: string | null;
  lastMessageSenderDid: string | null;
};

type ProfileRow = {
  did: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  avatarDataURI: string | null;
};

type MessageRow = {
  messageId: string;
  convoId: string;
  text: string;
  sentAt: string;
  senderDid: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  avatarDataURI: string | null;
};

export function BrowseMessages({ handle, palette, accountId }: Props) {
  const [conversations, setConversations] = useState<
    AutomationConversationPreviewData[]
  >([]);
  const [messages, setMessages] = useState<AutomationMessagePreviewData[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedConvo, setSelectedConvo] =
    useState<AutomationConversationPreviewData | null>(null);
  const accountUuidRef = useRef<string | null>(null);
  const messagesListRef = useRef<FlatList<AutomationMessagePreviewData> | null>(
    null
  );

  useEffect(() => {
    void loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const loadConversations = async () => {
    if (!accountId) {
      setError("Missing account");
      setLoadingConvos(false);
      return;
    }

    setLoadingConvos(true);
    setError(null);

    try {
      const meta = await fetchAccountMeta(accountId);
      if (!meta) {
        setError("Account not found");
        return;
      }
      accountUuidRef.current = meta.uuid;

      const db = await openAccountDb(meta.uuid);
      const convoRows = await db.getAllAsync<ConversationRow>(
        `SELECT convoId, memberDids, muted, status, unreadCount,
                lastMessageText, lastMessageSentAt, lastMessageSenderDid
         FROM conversation
         ORDER BY updatedAt DESC;`
      );

      if (convoRows.length === 0) {
        setConversations([]);
        return;
      }

      // Collect all participant DIDs for a single profile lookup
      const allDids = new Set<string>();
      for (const row of convoRows) {
        try {
          const parsed = JSON.parse(row.memberDids) as string[];
          parsed.forEach((did) => allDids.add(did));
          if (row.lastMessageSenderDid) {
            allDids.add(row.lastMessageSenderDid);
          }
        } catch {
          // ignore parse errors, will fall back to unknown
        }
      }

      let profilesByDid = new Map<string, ProfileRow>();
      if (allDids.size > 0) {
        const placeholders = Array.from(allDids)
          .map(() => "?")
          .join(",");
        const profileRows = await db.getAllAsync<ProfileRow>(
          `SELECT did, handle, displayName, avatarUrl, avatarDataURI
           FROM profile
           WHERE did IN (${placeholders});`,
          Array.from(allDids)
        );
        profilesByDid = new Map(profileRows.map((p) => [p.did, p]));
      }

      const mapped = convoRows.map((row) => {
        const memberDids = (() => {
          try {
            return (JSON.parse(row.memberDids) as string[]) ?? [];
          } catch {
            return [] as string[];
          }
        })();

        const members: AutomationProfileData[] = memberDids.map((did) => {
          const prof = profilesByDid.get(did);
          return {
            did,
            handle: prof?.handle ?? "unknown",
            displayName: prof?.displayName ?? null,
            avatarUrl: prof?.avatarUrl ?? prof?.avatarDataURI ?? null,
            avatarDataURI: prof?.avatarDataURI ?? undefined,
          };
        });

        return {
          convoId: row.convoId,
          lastMessageText: row.lastMessageText,
          lastMessageSentAt: row.lastMessageSentAt,
          unreadCount: row.unreadCount,
          muted: row.muted === 1,
          members,
        } satisfies AutomationConversationPreviewData;
      });

      setConversations(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingConvos(false);
    }
  };

  const loadMessages = async (convoId: string) => {
    const uuid = accountUuidRef.current;
    if (!uuid) return;

    setLoadingMessages(true);
    try {
      const db = await openAccountDb(uuid);
      const rows = await db.getAllAsync<MessageRow>(
        `SELECT m.messageId, m.convoId, m.text, m.sentAt, m.senderDid,
                p.handle, p.displayName, p.avatarUrl, p.avatarDataURI
         FROM message m
         LEFT JOIN profile p ON p.did = m.senderDid
         WHERE m.convoId = ?
         ORDER BY m.sentAt ASC, m.id ASC;`,
        [convoId]
      );

      const mapped: AutomationMessagePreviewData[] = rows.map((row) => ({
        messageId: row.messageId,
        convoId: row.convoId,
        text: row.text,
        sentAt: row.sentAt,
        sender: {
          did: row.senderDid,
          handle: row.handle ?? "unknown",
          displayName: row.displayName,
          avatarUrl: row.avatarUrl ?? row.avatarDataURI ?? undefined,
          avatarDataURI: row.avatarDataURI ?? undefined,
        },
      }));

      setMessages(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMessages(false);
    }
  };

  // When messages finish loading, scroll to the bottom once so newest messages show.
  useEffect(() => {
    if (selectedConvo && messages.length > 0 && !loadingMessages) {
      // Delay to allow layout to complete before scrolling.
      setTimeout(() => {
        messagesListRef.current?.scrollToEnd({ animated: false });
      }, 0);
    }
  }, [messages, loadingMessages, selectedConvo]);

  const renderConversation = useMemo(
    () =>
      ({ item }: { item: AutomationConversationPreviewData }) => (
        <Pressable
          onPress={() => {
            setSelectedConvo(item);
            void loadMessages(item.convoId);
          }}
        >
          <ConversationPreview conversation={item} palette={palette} />
        </Pressable>
      ),
    [palette]
  );

  const renderMessage = useMemo(
    () =>
      ({ item }: { item: AutomationMessagePreviewData }) => (
        <MessagePreview message={item} palette={palette} />
      ),
    [palette]
  );

  if (loadingConvos) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={palette.tint} />
        <Text style={[styles.loadingText, { color: palette.text }]}>
          Loading conversations...
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <BrowsePlaceholderCard
        palette={palette}
        title="Messages"
        message={error}
      />
    );
  }

  if (!conversations.length) {
    return (
      <BrowsePlaceholderCard
        palette={palette}
        title="Messages"
        message="No conversations saved yet."
      />
    );
  }

  if (selectedConvo) {
    return (
      <View style={styles.flex}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => {
              setSelectedConvo(null);
              setMessages([]);
            }}
          >
            <Text style={[styles.backText, { color: palette.tint }]}>
              ◀ Back
            </Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: palette.text }]}>
            {selectedConvo.members[0]?.displayName ||
              selectedConvo.members[0]?.handle ||
              "Conversation"}
          </Text>
        </View>

        {loadingMessages ? (
          <View style={styles.centered}>
            <ActivityIndicator color={palette.tint} />
            <Text style={[styles.loadingText, { color: palette.text }]}>
              Loading messages...
            </Text>
          </View>
        ) : (
          <FlatList
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.messageId}
            contentContainerStyle={styles.listContent}
            ref={messagesListRef}
          />
        )}
      </View>
    );
  }

  return (
    <FlatList
      data={conversations}
      renderItem={renderConversation}
      keyExtractor={(item) => item.convoId}
      contentContainerStyle={styles.listContent}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listContent: {
    paddingTop: 12,
    paddingBottom: 24,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 15,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  backText: {
    fontSize: 16,
    fontWeight: "600",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    flexShrink: 1,
  },
});

export default BrowseMessages;

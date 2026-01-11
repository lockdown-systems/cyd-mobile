import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ConversationPreview } from "@/components/ConversationPreview";
import { MessagePreview } from "@/components/MessagePreview";
import type {
  ConversationPreviewData,
  MessagePreviewData,
  ProfileData,
} from "@/controllers/bluesky/types";
import type { AccountTabPalette } from "@/types/account-tabs";

import { BrowsePlaceholderCard } from "./BrowsePlaceholderCard";
import { type DeletedFilter, fetchAccountMeta, openAccountDb } from "./shared";

type Props = {
  handle: string;
  palette: AccountTabPalette;
  accountId?: number;
  onCountChange?: (count: number, label: string) => void;
  onHeaderChange?: (
    header: {
      visible: boolean;
      title: string;
      onBack: () => void;
    } | null
  ) => void;
};

type ConversationRow = {
  convoId: string;
  memberDids: string; // JSON array
  muted: number;
  lastMessageText: string | null;
  lastMessageSentAt: string | null;
  lastMessageSenderDid: string | null;
};

type ProfileRow = {
  did: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
};

type MessageRow = {
  messageId: string;
  convoId: string;
  text: string;
  sentAt: string;
  savedAt: number;
  deletedAt: number | null;
  senderDid: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  embedJSON: string | null;
  facetsJSON: string | null;
};

export function BrowseMessages({
  handle,
  palette,
  accountId,
  onCountChange,
  onHeaderChange,
}: Props) {
  const [conversations, setConversations] = useState<ConversationPreviewData[]>(
    []
  );
  const [messages, setMessages] = useState<MessagePreviewData[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedConvo, setSelectedConvo] =
    useState<ConversationPreviewData | null>(null);
  const [filterText, setFilterText] = useState("");
  const [deletedFilter, setDeletedFilter] = useState<DeletedFilter>("all");
  const accountUuidRef = useRef<string | null>(null);

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
        `SELECT convoId, memberDids, muted,
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
          `SELECT did, handle, displayName, avatarUrl
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

        const members: ProfileData[] = memberDids.map((did) => {
          const prof = profilesByDid.get(did);
          return {
            did,
            handle: prof?.handle ?? "unknown",
            displayName: prof?.displayName ?? null,
            avatarUrl: prof?.avatarUrl ?? null,
          };
        });

        return {
          convoId: row.convoId,
          lastMessageText: row.lastMessageText,
          lastMessageSentAt: row.lastMessageSentAt,
          muted: row.muted === 1,
          members,
        } satisfies ConversationPreviewData;
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

      // Build deleted filter clause
      let deletedClause = "";
      if (deletedFilter === "deleted") {
        deletedClause = " AND m.deletedAt IS NOT NULL";
      } else if (deletedFilter === "not-deleted") {
        deletedClause = " AND m.deletedAt IS NULL";
      }

      const rows = await db.getAllAsync<MessageRow>(
        `SELECT m.messageId, m.convoId, m.text, m.sentAt, m.savedAt, m.deletedAt, m.senderDid,
          m.embedJSON, m.facetsJSON,
                p.handle, p.displayName, p.avatarUrl
         FROM message m
         LEFT JOIN profile p ON p.did = m.senderDid
         WHERE m.convoId = ?${deletedClause}
         ORDER BY m.sentAt DESC, m.id DESC;`,
        [convoId]
      );

      const parseUnknown = (value?: string | null): unknown => {
        if (!value) return null;
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return null;
        }
      };

      const parseEmbed = (
        value?: string | null
      ): Record<string, unknown> | null => {
        const parsed = parseUnknown(value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
        return null;
      };

      const mapped: MessagePreviewData[] = rows.map((row) => {
        const savedAtMs =
          typeof row.savedAt === "number"
            ? row.savedAt
            : Date.parse(row.sentAt);
        const deletedAtMs =
          typeof row.deletedAt === "number" ? row.deletedAt : null;

        return {
          messageId: row.messageId,
          convoId: row.convoId,
          text: row.text,
          sentAt: row.sentAt,
          savedAt: new Date(savedAtMs || Date.now()).toISOString(),
          deletedAt: deletedAtMs ? new Date(deletedAtMs).toISOString() : null,
          sender: {
            did: row.senderDid,
            handle: row.handle ?? "unknown",
            displayName: row.displayName,
            avatarUrl: row.avatarUrl ?? undefined,
          },
          embed: parseEmbed(row.embedJSON),
          facets: parseUnknown(row.facetsJSON) as unknown[] | null,
        };
      });

      setMessages(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMessages(false);
    }
  };

  // Filter messages based on filter text (case insensitive)
  const filteredMessages = useMemo(() => {
    if (!filterText.trim()) {
      return messages;
    }
    const searchTerm = filterText.toLowerCase();
    return messages.filter(
      (message) =>
        message.text?.toLowerCase().includes(searchTerm) ||
        message.sender?.handle?.toLowerCase().includes(searchTerm) ||
        message.sender?.displayName?.toLowerCase().includes(searchTerm)
    );
  }, [messages, filterText]);

  // Report conversation count when viewing conversations list
  useEffect(() => {
    if (!selectedConvo && !loadingConvos && !error) {
      onCountChange?.(
        conversations.length,
        `Showing ${conversations.length.toLocaleString()} chat conversation${conversations.length === 1 ? "" : "s"}`
      );
      // Clear header when not viewing a conversation
      onHeaderChange?.(null);
    }
  }, [
    conversations.length,
    selectedConvo,
    loadingConvos,
    error,
    onCountChange,
    onHeaderChange,
  ]);

  // Report message count when viewing a specific conversation
  useEffect(() => {
    if (selectedConvo && !loadingMessages) {
      const memberName =
        selectedConvo.members[0]?.displayName ||
        selectedConvo.members[0]?.handle ||
        "Unknown";

      const hasTextFilter = filterText.trim().length > 0;
      const hasDeletedFilter = deletedFilter !== "all";
      const displayCount = hasTextFilter
        ? filteredMessages.length
        : messages.length;

      // Build the label
      let label = `Showing ${displayCount.toLocaleString()} message${displayCount === 1 ? "" : "s"} with ${memberName}`;
      if (hasDeletedFilter) {
        const filterLabel =
          deletedFilter === "deleted" ? "deleted" : "not deleted";
        label = `Showing ${displayCount.toLocaleString()} ${filterLabel} message${displayCount === 1 ? "" : "s"} with ${memberName}`;
      }
      if (hasTextFilter) {
        label += " (filtered)";
      }

      onCountChange?.(displayCount, label);

      // Report header info
      onHeaderChange?.({
        visible: true,
        title:
          selectedConvo.members[0]?.displayName ||
          selectedConvo.members[0]?.handle ||
          "Conversation",
        onBack: () => {
          setSelectedConvo(null);
          setMessages([]);
        },
      });
    }
  }, [
    deletedFilter,
    filterText,
    filteredMessages.length,
    messages.length,
    selectedConvo,
    loadingMessages,
    onCountChange,
    onHeaderChange,
  ]);

  const renderConversation = useMemo(() => {
    const ConversationItem = ({ item }: { item: ConversationPreviewData }) => (
      <Pressable
        onPress={() => {
          setSelectedConvo(item);
          void loadMessages(item.convoId);
        }}
      >
        <ConversationPreview conversation={item} palette={palette} />
      </Pressable>
    );
    ConversationItem.displayName = "BrowseMessagesConversationItem";
    return ConversationItem;
    // loadMessages is stable - only reads from refs and deletedFilter which is handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette]);

  const renderMessage = useMemo(() => {
    const MessageItem = ({ item }: { item: MessagePreviewData }) => (
      <MessagePreview message={item} palette={palette} />
    );
    MessageItem.displayName = "BrowseMessagesMessageItem";
    return MessageItem;
  }, [palette]);

  // Reload messages when deleted filter changes
  useEffect(() => {
    if (selectedConvo) {
      void loadMessages(selectedConvo.convoId);
    }
    // loadMessages uses deletedFilter internally, so it will trigger a refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deletedFilter, selectedConvo]);

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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 140 : 0}
      >
        {loadingMessages ? (
          <View style={styles.centered}>
            <ActivityIndicator color={palette.tint} />
            <Text style={[styles.loadingText, { color: palette.text }]}>
              Loading messages...
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredMessages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.messageId}
            contentContainerStyle={styles.listContent}
            inverted
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          />
        )}
        <View
          style={[
            styles.filterBar,
            {
              backgroundColor: palette.background,
              borderTopColor: palette.icon,
            },
          ]}
        >
          <TextInput
            style={[
              styles.filterInput,
              {
                backgroundColor: palette.background,
                color: palette.text,
                borderColor: palette.icon,
              },
            ]}
            placeholder="Filter messages..."
            placeholderTextColor={palette.icon}
            value={filterText}
            onChangeText={setFilterText}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
          <View style={styles.toggleRow}>
            {(["all", "deleted", "not-deleted"] as const).map((option) => (
              <Pressable
                key={option}
                onPress={() => setDeletedFilter(option)}
                style={[
                  styles.toggleOption,
                  {
                    backgroundColor:
                      deletedFilter === option
                        ? palette.tint
                        : palette.background,
                    borderColor: palette.icon,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.toggleText,
                    {
                      color:
                        deletedFilter === option
                          ? palette.background
                          : palette.text,
                    },
                  ]}
                >
                  {option === "all"
                    ? "Show All"
                    : option === "deleted"
                      ? "Deleted"
                      : "Not Deleted"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </KeyboardAvoidingView>
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
  filterBar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  filterInput: {
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  toggleRow: {
    flexDirection: "row",
    gap: 8,
  },
  toggleOption: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  toggleText: {
    fontSize: 13,
    fontWeight: "500",
  },
});

export default BrowseMessages;

import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { GLOBAL_CHAT_ROOM, chatMessages, type ChatMessage } from "@/db/schema";

const MIN_NAME_LENGTH = 1;
const MAX_NAME_LENGTH = 24;
const MAX_ROOM_LENGTH = 48;
const MIN_MESSAGE_LENGTH = 1;
const MAX_MESSAGE_LENGTH = 500;
const DEFAULT_FETCH_LIMIT = 60;

const STOP_WORDS = new Set([
  "the",
  "and",
  "that",
  "with",
  "this",
  "from",
  "have",
  "your",
  "you",
  "are",
  "for",
  "not",
  "but",
  "can",
  "will",
  "just",
  "about",
  "what",
  "when",
  "where",
  "who",
  "why",
  "how",
  "here",
  "there",
  "they",
  "them",
  "our",
  "out",
  "into",
  "all",
  "any",
  "too",
  "was",
  "were",
  "has",
  "had",
  "been",
  "i",
  "me",
  "my",
  "we",
  "us",
  "if",
  "so",
  "do",
  "does",
  "did",
]);

export type ChatMessageView = {
  id: number;
  room: string;
  username: string;
  content: string;
  createdAt: string;
};

export type ConversationInsight = {
  activeSpeaker: string;
  likelyTopic: string;
  tone: string;
};

export type CreateMessageInput = {
  room?: string;
  username: string;
  content: string;
};

export type ChatPayload = {
  room?: string;
  username?: string;
  content?: string;
};

export function normalizeRoom(value: unknown) {
  const room = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!room) {
    return GLOBAL_CHAT_ROOM;
  }

  const collapsed = room.replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "");
  return collapsed.slice(0, MAX_ROOM_LENGTH) || GLOBAL_CHAT_ROOM;
}

export function normalizeUsername(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return "Guest";
  }

  return raw
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, MAX_NAME_LENGTH);
}

export function normalizeMessageContent(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_MESSAGE_LENGTH);
}

export function validateChatPayload(value: unknown): CreateMessageInput {
  const payload = typeof value === "object" && value !== null ? (value as ChatPayload) : {};
  const username = normalizeUsername(payload.username);
  const content = normalizeMessageContent(payload.content);
  const room = normalizeRoom(payload.room);

  if (username.length < MIN_NAME_LENGTH) {
    throw new Error("Please choose a display name.");
  }

  if (username.length > MAX_NAME_LENGTH) {
    throw new Error(`Display names must be ${MAX_NAME_LENGTH} characters or fewer.`);
  }

  if (content.length < MIN_MESSAGE_LENGTH) {
    throw new Error("Type a message before sending.");
  }

  if (content.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
  }

  return { room, username, content };
}

export function serializeMessage(message: ChatMessage): ChatMessageView {
  return {
    id: message.id,
    room: message.room,
    username: message.username,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}

export async function listMessages(room = GLOBAL_CHAT_ROOM, limit = DEFAULT_FETCH_LIMIT) {
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_FETCH_LIMIT, 100));
  const normalizedRoom = normalizeRoom(room);

  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.room, normalizedRoom))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(safeLimit);

  return rows.reverse().map(serializeMessage);
}

export async function createMessage(input: CreateMessageInput) {
  const room = normalizeRoom(input.room);
  const username = normalizeUsername(input.username);
  const content = normalizeMessageContent(input.content);

  const [message] = await db
    .insert(chatMessages)
    .values({ room, username, content })
    .returning();

  if (!message) {
    throw new Error("Failed to save the message.");
  }

  return serializeMessage(message);
}

export async function getConversationInsights(room = GLOBAL_CHAT_ROOM) {
  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.room, normalizeRoom(room)))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(25);

  return deriveConversationInsights(messages.reverse());
}

export function deriveConversationInsights(messages: Pick<ChatMessage, "username" | "content">[]): ConversationInsight {
  if (messages.length === 0) {
    return {
      activeSpeaker: "No one yet",
      likelyTopic: "Introductions",
      tone: "Waiting for the first message",
    };
  }

  const speakerCounts = new Map<string, number>();
  const keywordCounts = new Map<string, number>();
  let energeticSignals = 0;

  for (const message of messages) {
    speakerCounts.set(message.username, (speakerCounts.get(message.username) ?? 0) + 1);

    const words = message.content
      .toLowerCase()
      .match(/[a-z0-9']+/g)
      ?? [];

    for (const word of words) {
      if (word.length < 4 || STOP_WORDS.has(word)) {
        continue;
      }
      keywordCounts.set(word, (keywordCounts.get(word) ?? 0) + 1);
    }

    if (/[!?]{2,}/.test(message.content) || /\b(lol|awesome|great|nice|yay|woo)\b/i.test(message.content)) {
      energeticSignals += 1;
    }
  }

  const activeSpeaker = [...speakerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Everyone";
  const likelyTopic = [...keywordCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "general chat";
  const tone = energeticSignals >= Math.max(2, Math.floor(messages.length / 3)) ? "Energetic and lively" : "Calm and focused";

  return {
    activeSpeaker,
    likelyTopic,
    tone,
  };
}

export async function getChatStats(room = GLOBAL_CHAT_ROOM) {
  const normalizedRoom = normalizeRoom(room);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(chatMessages)
    .where(eq(chatMessages.room, normalizedRoom));

  const latest = await db
    .select({ createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .where(eq(chatMessages.room, normalizedRoom))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(1);

  return {
    messageCount: Number(count ?? 0),
    lastMessageAt: latest[0]?.createdAt?.toISOString() ?? null,
  };
}

export { GLOBAL_CHAT_ROOM };

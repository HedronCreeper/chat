import { index, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const GLOBAL_CHAT_ROOM = "global";

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    room: varchar("room", { length: 64 }).notNull().default(GLOBAL_CHAT_ROOM),
    username: varchar("username", { length: 32 }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomCreatedAtIdx: index("chat_messages_room_created_at_idx").on(table.room, table.createdAt),
    createdAtIdx: index("chat_messages_created_at_idx").on(table.createdAt),
  }),
);

export type ChatMessage = typeof chatMessages.$inferSelect;

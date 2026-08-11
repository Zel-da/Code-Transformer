import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";

export interface FeedbackAttachment {
  url: string;
  name: string;
  mimeType: string;
}

export const feedbackTable = pgTable("feedback", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  authorId: integer("author_id").notNull(),
  /** OPEN | IN_PROGRESS | RESOLVED | CLOSED */
  status: text("status").notNull().default("OPEN"),
  attachments: jsonb("attachments")
    .$type<FeedbackAttachment[]>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Feedback = typeof feedbackTable.$inferSelect;

export const feedbackCommentsTable = pgTable("feedback_comments", {
  id: serial("id").primaryKey(),
  feedbackId: integer("feedback_id").notNull(),
  authorId: integer("author_id").notNull(),
  content: text("content").notNull(),
  isAdminReply: boolean("is_admin_reply").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type FeedbackComment = typeof feedbackCommentsTable.$inferSelect;

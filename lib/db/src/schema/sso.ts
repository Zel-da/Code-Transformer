import { pgTable, text, integer, timestamp, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./nonConformityReports";

// Provider identities remain stable even if a user's email changes.
export const ssoIdentitiesTable = pgTable("ncr_sso_identities", {
  provider: text("provider").notNull(),
  subject: text("subject").notNull(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
}, (t) => [
  primaryKey({ columns: [t.provider, t.subject] }),
  uniqueIndex("ncr_sso_identity_user_idx").on(t.provider, t.userId),
]);

export const ssoSessionsTable = pgTable("ncr_sso_sessions", {
  idHash: text("id_hash").primaryKey(),
  kind: text("kind").notNull(),
  stateHash: text("state_hash"),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  subject: text("subject"),
  provider: text("provider").notNull(),
  encryptedToken: text("encrypted_token"),
  nextPath: text("next_path").notNull().default("/ledger"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

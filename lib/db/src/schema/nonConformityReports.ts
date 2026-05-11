import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  real,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const itemCodesTable = pgTable("item_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertItemCodeSchema = createInsertSchema(itemCodesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertItemCode = z.infer<typeof insertItemCodeSchema>;
export type ItemCode = typeof itemCodesTable.$inferSelect;

export const syncStatusEnum = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] as const;

export const nonConformityReportsTable = pgTable("non_conformity_reports", {
  id: serial("id").primaryKey(),
  reportDate: timestamp("report_date", { withTimezone: true }).notNull().defaultNow(),
  itemCode: text("item_code").notNull(),
  processName: text("process_name").notNull(),
  defectType: text("defect_type").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url"),
  syncStatus: text("sync_status")
    .$type<(typeof syncStatusEnum)[number]>()
    .notNull()
    .default("PENDING"),
  registrantName: text("registrant_name"),
  ncrType: text("ncr_type"),
  factory: text("factory"),
  shipmentUnit: text("shipment_unit"),
  lostManHours: real("lost_man_hours"),
  defectQty: integer("defect_qty"),
  occurrenceDate: timestamp("occurrence_date", { withTimezone: true }),
  issuingTeam: text("issuing_team"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertNonConformityReportSchema = createInsertSchema(
  nonConformityReportsTable,
).omit({
  id: true,
  syncStatus: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertNonConformityReport = z.infer<
  typeof insertNonConformityReportSchema
>;
export type NonConformityReport = typeof nonConformityReportsTable.$inferSelect;

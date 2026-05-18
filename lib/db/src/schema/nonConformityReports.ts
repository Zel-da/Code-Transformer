import {
  pgTable,
  pgEnum,
  text,
  serial,
  timestamp,
  integer,
  real,
  boolean,
  primaryKey,
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

export const plantsTable = pgTable("plants", {
  plantCd: text("plant_cd").primaryKey(),
  plantNm: text("plant_nm").notNull(),
});
export type Plant = typeof plantsTable.$inferSelect;

export const flawTypesTable = pgTable("flaw_types", {
  typeCd: text("type_cd").primaryKey(),
  typeNm: text("type_nm").notNull(),
  sortIndex: integer("sort_index").notNull().default(0),
});
export type FlawType = typeof flawTypesTable.$inferSelect;

export const processesTable = pgTable(
  "processes",
  {
    plantCd: text("plant_cd").notNull(),
    processCd: text("process_cd").notNull(),
    processNm: text("process_nm").notNull(),
    laborCost: real("labor_cost").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.plantCd, t.processCd] })],
);
export type Process = typeof processesTable.$inferSelect;

export const dispositionsTable = pgTable("dispositions", {
  dispositionCd: text("disposition_cd").primaryKey(),
  dispositionNm: text("disposition_nm").notNull(),
  inspClassCd: text("insp_class_cd").notNull(),
  stockType: text("stock_type").notNull(),
});
export type Disposition = typeof dispositionsTable.$inferSelect;

export const departmentsTable = pgTable("departments", {
  deptCd: text("dept_cd").primaryKey(),
  deptName: text("dept_name").notNull(),
  isFrequent: boolean("is_frequent").notNull().default(false),
});
export type Department = typeof departmentsTable.$inferSelect;

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").$type<"admin" | "worker">().notNull().default("worker"),
  isActive: boolean("is_active").notNull().default(true),
  deptCd: text("dept_cd"),
  factory: text("factory"),
  plantCd: text("plant_cd"),
  processName: text("process_name"),
  processCd: text("process_cd"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
export type PublicUser = Omit<User, "passwordHash">;

export const syncStatusEnum = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] as const;

export const productTypeEnum = pgEnum("product_type_enum", ["양산", "개발"]);

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
  plantCd: text("plant_cd"),
  processCd: text("process_cd"),
  flawTypeCd: text("flaw_type_cd"),
  deptCd: text("dept_cd"),
  ncrGbnCd: text("ncr_gbn_cd"),
  // V2.0 columns
  productType: productTypeEnum("product_type"),
  labNotifiedAt: timestamp("lab_notified_at", { withTimezone: true }),
  ssushanTalkSentAt: timestamp("ssushan_talk_sent_at", { withTimezone: true }),
  slaDeadlineAt: timestamp("sla_deadline_at", { withTimezone: true }),
  isLocked: boolean("is_locked").notNull().default(false),
  qcAction: text("qc_action"),
  qcActionAt: timestamp("qc_action_at", { withTimezone: true }),
  qcActionedBy: integer("qc_actioned_by").references(() => usersTable.id, { onDelete: "set null" }),
  // V2.0 RPA 재시도 관련 컬럼
  syncAttemptCount: integer("sync_attempt_count").notNull().default(0),
  syncLastError: text("sync_last_error"),
  syncNextRetryAt: timestamp("sync_next_retry_at", { withTimezone: true }),
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

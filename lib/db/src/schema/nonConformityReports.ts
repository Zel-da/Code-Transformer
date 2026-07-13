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
  jsonb,
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
  webhookUrl: text("webhook_url"),
});
export type Department = typeof departmentsTable.$inferSelect;

export const vendorsTable = pgTable("vendors", {
  vendorCd: text("vendor_cd").primaryKey(),
  vendorNm: text("vendor_nm").notNull(),
  taxNo: text("tax_no"), // 사업자번호 (10자리, 있으면)
  validFlg: boolean("valid_flg").notNull().default(true),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Vendor = typeof vendorsTable.$inferSelect;

// UNIERP 품목그룹 마스터 (B_ITEM_GROUP 동기화).
// RPA가 부적합등록 폼의 품목그룹 칸에 group_cd(예: CL411)를 박을 때 사용.
// 보고서의 item_codes.category(=group_nm)를 lookup해서 group_cd 변환.
export const itemGroupsTable = pgTable("item_groups", {
  groupCd: text("group_cd").primaryKey(),
  groupNm: text("group_nm").notNull(),
  validFlg: boolean("valid_flg").notNull().default(true),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ItemGroup = typeof itemGroupsTable.$inferSelect;

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  role: text("role").$type<"admin" | "worker" | "reviewer" | "approver" | "collaborator">().notNull().default("worker"),
  isActive: boolean("is_active").notNull().default(true),
  deptCd: text("dept_cd"),
  factory: text("factory"),
  plantCd: text("plant_cd"),
  processName: text("process_name"),
  processCd: text("process_cd"),
  notifyLevel: text("notify_level").$type<"to" | "cc" | "none">().notNull().default("to"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
export type PublicUser = Omit<User, "passwordHash">;

// REVIEW: RPA 가 UNIERP 입력·저장 완료 후 사용자가 배치 검토 UI 에서
// 최종 확인하기까지 머무는 상태. DB 로 승격돼야 서버·워커 재시작에도
// 살아남는다(예전 in-memory erp_review_queue 는 재시작 시 소실됐음).
// 사용자가 [확인] 하면 COMPLETED, [실패] 하면 FAILED, 재시도 원하면 PENDING 복원.
export const syncStatusEnum = ["PENDING", "PROCESSING", "REVIEW", "COMPLETED", "FAILED"] as const;

export const productTypeEnum = pgEnum("product_type_enum", ["양산", "개발"]);

export const nonConformityReportsTable = pgTable("non_conformity_reports", {
  id: serial("id").primaryKey(),
  reportDate: timestamp("report_date", { withTimezone: true }).notNull().defaultNow(),
  itemCode: text("item_code").notNull(),
  modelName: text("model_name"),
  processName: text("process_name").notNull(),
  defectType: text("defect_type").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url"),
  imageUrls: text("image_urls").array(),
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
  // 거래처(협력사). vendor_cd는 vendors.vendor_cd 또는 사업자번호(둘 다 허용).
  // vendor_nm은 보고 시점의 거래처명을 그대로 보관(감사용).
  vendorCd: text("vendor_cd"),
  vendorNm: text("vendor_nm"),
  // 품목그룹(ITEM_GROUP_NM, ERP B_ITEM_GROUP). 모델별 분석/필터용. 보고 시점 값 그대로 보관.
  itemGroup: text("item_group"),
  // V2.0 columns
  productType: productTypeEnum("product_type"),
  labNotifiedAt: timestamp("lab_notified_at", { withTimezone: true }),
  ssushanTalkSentAt: timestamp("ssushan_talk_sent_at", { withTimezone: true }),
  slaDeadlineAt: timestamp("sla_deadline_at", { withTimezone: true }),
  isLocked: boolean("is_locked").notNull().default(false),
  qcAction: text("qc_action"),
  qcActionAt: timestamp("qc_action_at", { withTimezone: true }),
  qcActionedBy: integer("qc_actioned_by").references(() => usersTable.id, { onDelete: "set null" }),
  // 조치 방향 (등록 시 필수 선택)
  actionDirection: text("action_direction"),
  // QC 분석 전용 컬럼
  qcStatus: text("qc_status").$type<"OPEN" | "IN_REVIEW" | "PENDING_COLLAB" | "RESOLVED" | "APPROVED" | "ERP_SYNCED" | null>().default("OPEN"),
  qcCorrectiveResult: text("qc_corrective_result"),
  judgmentResult: text("judgment_result"),
  claimStatus: text("claim_status"),
  partsCost: integer("parts_cost").notNull().default(0),
  laborCost: integer("labor_cost").notNull().default(0),
  qcSubmittedAt: timestamp("qc_submitted_at", { withTimezone: true }),
  qcSubmittedBy: integer("qc_submitted_by").references(() => usersTable.id, { onDelete: "set null" }),
  // Task #34: NCR 채번 (QC-YYMM-NNNN)
  ncrNumber: text("ncr_number").unique(),
  // ERP 누락 필드 (Task #33)
  remarks: text("remarks"),
  shipmentDateFrom: timestamp("shipment_date_from", { withTimezone: true }),
  shipmentDateTo: timestamp("shipment_date_to", { withTimezone: true }),
  managerCd: text("manager_cd"),
  managerNm: text("manager_nm"),
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

export const reportCommentsTable = pgTable("report_comments", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id")
    .notNull()
    .references(() => nonConformityReportsTable.id, { onDelete: "cascade" }),
  authorId: integer("author_id").references(() => usersTable.id, { onDelete: "set null" }),
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  taggedUserIds: integer("tagged_user_ids").array().notNull().default([]),
  isEdited: boolean("is_edited").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
export type ReportComment = typeof reportCommentsTable.$inferSelect;

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  actorName: text("actor_name").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id"),
  detail: text("detail"),
  beforeVal: jsonb("before_val"),
  afterVal: jsonb("after_val"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AuditLog = typeof auditLogsTable.$inferSelect;

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

import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * ERP 제조오더(호기 보유분) 미러. erp_query/sync_orders.py 가 매일 upsert.
 * 출하호기 → 제품/공장 자동조회의 클라우드 측 소스.
 * 호기는 정수 범위(hogiFrom~hogiTo)로 저장 — 조회는 숫자 BETWEEN.
 */
export const productionOrdersTable = pgTable(
  "production_orders",
  {
    prodtOrderNo: text("prodt_order_no").primaryKey(),
    itemCode: text("item_code").notNull(),
    plantCd: text("plant_cd"),
    hogiFrom: integer("hogi_from"),
    hogiTo: integer("hogi_to"),
    orderStatus: text("order_status"),
    planStart: text("plan_start"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("production_orders_item_code_idx").on(t.itemCode)],
);

export type ProductionOrder = typeof productionOrdersTable.$inferSelect;

import { pgTable, text, integer, timestamp, serial, index } from "drizzle-orm/pg-core";

/**
 * ERP 출하 이력(XW_DELIVERY_CAR_INFO) 미러. erp_query/sync_shipments.py 가 매일 truncate+insert.
 *
 * 출하호기 → 거래처(BP_CD) 정확 매칭의 가장 신뢰할 만한 데이터 소스.
 *  - production_orders는 생산 진행 호기, shipments는 이미 출하된 호기 (별개 모집단)
 *  - bp_cd 는 vendors.vendor_cd 와 1:1 조인 가능
 *  - out_hogi 는 알파뉴메릭 가능 (예: 'WA-91381'). 숫자 매칭은 out_hogi_int 사용.
 */
export const shipmentsTable = pgTable(
  "shipments",
  {
    id: serial("id").primaryKey(),
    itemCode: text("item_code").notNull(),
    outHogi: text("out_hogi").notNull(),
    outHogiInt: integer("out_hogi_int"), // TRY_CAST(out_hogi AS INT). 숫자 호기 매칭용. 비정수면 NULL.
    bpCd: text("bp_cd"),
    realOutDt: timestamp("real_out_dt", { withTimezone: true }),
    vehicleNo: text("vehicle_no"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("shipments_item_code_idx").on(t.itemCode),
    index("shipments_bp_cd_idx").on(t.bpCd),
    index("shipments_item_hogi_int_idx").on(t.itemCode, t.outHogiInt),
  ],
);

export type Shipment = typeof shipmentsTable.$inferSelect;

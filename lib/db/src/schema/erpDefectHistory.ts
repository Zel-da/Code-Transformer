import { pgTable, serial, text, integer, numeric, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * K-System Q_FLAW_CKO063 의 미러. erp_query/sync_defect_history.py 가 bulk 적재 + 매일 증분.
 *
 * 목적:
 *  1) UNIERP 부적합판정등록(S)(QD231MA1_CKO063) 의 모든 과거 데이터를 Neon 에 보관 →
 *     현장(태블릿)에서 "유사 과거 불량·조치" 즉시 조회
 *  2) 분석·통계 — 아산/화성 공장별, 공정별, 품목별 트렌드
 *
 * 주의: 이 테이블은 "라이브 신규 보고" 아님. 신규 보고는 non_conformity_reports 유지.
 *       통합 조회는 v_all_defect_history (SQL VIEW) 사용.
 *
 * FLAW_GBN 값: QC(공정) / QO(출하) / AS(A/S) / QI / QA 등.
 * PLANT_CD:   SA00(아산) / SH00(화성).
 */
export const erpDefectHistoryTable = pgTable(
  "erp_defect_history",
  {
    id: serial("id").primaryKey(),
    erpReportNo: text("erp_report_no").notNull(),                       // Q_FLAW_CKO063.REPORT_NO (예: QA2611058)
    statusFlag: text("status_flag"),                                     // P10 / P20 등 상태
    deptCd: text("dept_cd"),
    deptNm: text("dept_nm"),
    flawGbn: text("flaw_gbn"),                                           // QC(공정)/QO(출하)/AS/QI/QA
    repairNo: text("repair_no"),
    reportDate: timestamp("report_date", { withTimezone: true }),
    inputDate: timestamp("input_date", { withTimezone: true }),
    plantCd: text("plant_cd"),                                           // SA00/SH00 (조회 필수 필터)
    processCd: text("process_cd"),
    itemCode: text("item_code"),
    itemGroupCd: text("item_group_cd"),
    parItemCode: text("par_item_code"),                                  // 상위 제품(어셈블리)
    outHogi: text("out_hogi"),
    flawQty: numeric("flaw_qty"),
    typeCd: text("type_cd"),                                             // 불량 유형 A~Z
    lossMh: numeric("loss_mh"),
    vendorCd: text("vendor_cd"),                                         // Q_FLAW.BP_CD
    issueDate: timestamp("issue_date", { withTimezone: true }),
    remark: text("remark"),
    initQaYn: text("init_qa_yn"),
    relDeptYn: text("rel_dept_yn"),
    relDeptCd: text("rel_dept_cd"),
    relDeptDate: timestamp("rel_dept_date", { withTimezone: true }),
    relDeptComment: text("rel_dept_comment"),
    relDeptUserId: text("rel_dept_user_id"),
    claimYn: text("claim_yn"),
    partCost: numeric("part_cost"),
    laborCost: numeric("labor_cost"),
    claimAmt: numeric("claim_amt"),
    finalClaimAmt: numeric("final_claim_amt"),
    decideResult: text("decide_result"),
    flawState: text("flaw_state"),                                       // 현상(자유텍스트)
    actResult: text("act_result"),                                       // 조치결과(자유텍스트)
    capYn: text("cap_yn"),                                               // 시정·예방조치 유무
    capAction: text("cap_action"),                                       // 시정·예방조치 내용
    qaComment: text("qa_comment"),                                       // 품질 의견
    decideYn: text("decide_yn"),
    decideDate: timestamp("decide_date", { withTimezone: true }),
    signYn: text("sign_yn"),
    signDate: timestamp("sign_date", { withTimezone: true }),
    finalYn: text("final_yn"),
    finalDate: timestamp("final_date", { withTimezone: true }),
    insrtUserId: text("insrt_user_id"),
    insrtDate: timestamp("insrt_date", { withTimezone: true }),           // K-System 등록 시각 (증분 기준)
    updtUserId: text("updt_user_id"),
    updtDate: timestamp("updt_date", { withTimezone: true }),
    regDate: timestamp("reg_date", { withTimezone: true }),
    bizDate: timestamp("biz_date", { withTimezone: true }),
    useItemSeq: numeric("use_item_seq"),
    // 원본 50 컬럼 전부 보존 — 추후 추가 필드 생기면 여기서 추출 가능.
    rawPayload: jsonb("raw_payload"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("erp_defect_report_no_uniq").on(t.erpReportNo),
    index("erp_defect_plant_insrt_idx").on(t.plantCd, t.insrtDate),
    index("erp_defect_item_code_idx").on(t.itemCode),
    index("erp_defect_gbn_plant_idx").on(t.flawGbn, t.plantCd),
    index("erp_defect_process_cd_idx").on(t.processCd),
  ],
);

export type ErpDefectHistory = typeof erpDefectHistoryTable.$inferSelect;
export type InsertErpDefectHistory = typeof erpDefectHistoryTable.$inferInsert;

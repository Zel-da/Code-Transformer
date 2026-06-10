import { Router, type IRouter } from "express";
import { eq, ne, sql, and, gte, lte, count, lt } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db, nonConformityReportsTable, departmentsTable } from "@workspace/db";
import {
  ListReportsQueryParams,
  CreateReportBody,
  GetReportParams,
  UpdateReportSyncStatusParams,
  UpdateReportSyncStatusBody,
  UpdateReportBody,
  UpdateReportParams,
  DeleteReportParams,
  SubmitQcActionBody,
  SubmitQcActionParams,
  UpdateReportQcBody,
  UpdateReportQcParams,
} from "@workspace/api-zod";
import { requireAdmin, requireAuth, requireRole, type UserRole } from "../middleware/requireAuth.js";
import { sendSushantalkMessage, sendSushantalkToUrl } from "../lib/sushantalk.js";
import { z } from "zod";

const CloseMonthBody = z.object({
  year: z.number().int().min(2020).max(2099),
  month: z.number().int().min(1).max(12),
});

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function generateNcrNumber(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `QC-${yy}${mm}-`;

  // Advisory lock: ensures only one concurrent numbering per DB session
  await tx.execute(sql`SELECT pg_advisory_xact_lock(8675309)`);

  // Use MAX(suffix) instead of COUNT to avoid collisions after deletions.
  // Compute MAX in JS to avoid SUBSTRING FROM $N parameterization quirks.
  const rows = await tx
    .select({ ncrNumber: nonConformityReportsTable.ncrNumber })
    .from(nonConformityReportsTable)
    .where(sql`${nonConformityReportsTable.ncrNumber} LIKE ${prefix + "%"}`);

  const maxSeq = rows.reduce((max, r) => {
    const n = parseInt(r.ncrNumber?.slice(prefix.length) ?? "", 10);
    return isNaN(n) ? max : Math.max(max, n);
  }, 0);

  const seq = (maxSeq + 1).toString().padStart(4, "0");
  return `${prefix}${seq}`;
}

const router: IRouter = Router();

router.get("/reports", async (req, res): Promise<void> => {
  const parsed = ListReportsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { defectType, syncStatus, dateFrom, dateTo, page, pageSize } =
    parsed.data;

  // qcStatus / excludeErpSynced는 openapi spec 외 파라미터 — req.query에서 직접 추출
  const qcStatusRaw = typeof req.query.qcStatus === "string" ? req.query.qcStatus : undefined;
  const validQcStatuses = ["OPEN", "IN_REVIEW", "PENDING_COLLAB", "RESOLVED", "APPROVED", "ERP_SYNCED"] as const;
  type QcStatusFilter = (typeof validQcStatuses)[number];
  const qcStatus = validQcStatuses.includes(qcStatusRaw as QcStatusFilter) ? (qcStatusRaw as QcStatusFilter) : undefined;
  const excludeErpSynced = req.query.excludeErpSynced === "true";

  const conditions = [];
  if (defectType) {
    conditions.push(eq(nonConformityReportsTable.defectType, defectType));
  }
  if (syncStatus) {
    conditions.push(eq(nonConformityReportsTable.syncStatus, syncStatus as "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"));
  }
  if (qcStatus) {
    conditions.push(eq(nonConformityReportsTable.qcStatus, qcStatus));
  } else if (excludeErpSynced) {
    conditions.push(ne(nonConformityReportsTable.qcStatus, "ERP_SYNCED"));
  }
  if (dateFrom) {
    conditions.push(gte(nonConformityReportsTable.reportDate, dateFrom));
  }
  if (dateTo) {
    conditions.push(lte(nonConformityReportsTable.reportDate, dateTo));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult] = await db
    .select({ count: count() })
    .from(nonConformityReportsTable)
    .where(whereClause);

  const total = Number(totalResult?.count ?? 0);
  const offset = (page - 1) * pageSize;

  const reports = await db
    .select()
    .from(nonConformityReportsTable)
    .where(whereClause)
    .orderBy(sql`${nonConformityReportsTable.createdAt} DESC`)
    .limit(pageSize)
    .offset(offset);

  res.json({ data: reports, total, page, pageSize });
});

router.post("/reports", async (req, res): Promise<void> => {
  const parsed = CreateReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const d = parsed.data;

  // SLA 마감: 접수 시각 + 24시간
  const reportDate = d.reportDate ? new Date(d.reportDate) : new Date();
  const slaDeadlineAt = new Date(reportDate.getTime() + 24 * 60 * 60 * 1000);

  const [report] = await db.transaction(async (tx) => {
    const ncrNumber = await generateNcrNumber(tx);
    return tx
      .insert(nonConformityReportsTable)
      .values({
        ncrNumber,
        reportDate,
        itemCode: d.itemCode,
        modelName: d.modelName ?? null,
        processName: d.processName,
        defectType: d.defectType,
        description: d.description,
        imageUrl: d.imageUrl ?? null,
        syncStatus: "PENDING",
        registrantName: d.registrantName ?? null,
        ncrType: d.ncrType ?? null,
        factory: d.factory ?? null,
        shipmentUnit: d.shipmentUnit ?? null,
        lostManHours: d.lostManHours ?? null,
        defectQty: d.defectQty ?? null,
        occurrenceDate: d.occurrenceDate ?? null,
        issuingTeam: d.issuingTeam ?? null,
        plantCd: d.plantCd ?? null,
        processCd: d.processCd ?? null,
        flawTypeCd: d.flawTypeCd ?? null,
        deptCd: d.deptCd ?? null,
        ncrGbnCd: d.ncrGbnCd ?? null,
        vendorCd: d.vendorCd ?? null,
        vendorNm: d.vendorNm ?? null,
        productType: d.productType ?? null,
        actionDirection: d.actionDirection ?? null,
        remarks: d.remarks ?? null,
        shipmentDateFrom: d.shipmentDateFrom ? new Date(d.shipmentDateFrom) : null,
        shipmentDateTo: d.shipmentDateTo ? new Date(d.shipmentDateTo) : null,
        managerCd: d.managerCd ?? null,
        managerNm: d.managerNm ?? null,
        slaDeadlineAt,
      })
      .returning();
  });

  req.log.info({ reportId: report.id, productType: report.productType }, "Non-conformity report created");
  res.status(201).json(report);

  // Fire-and-forget: 수산톡 웹훅 비동기 발송 (클라이언트 대기 없음)
  (async () => {
    try {
      const channel = report.productType === "개발" ? "lab" : "qc";
      const appUrl = process.env.APP_URL ?? "https://your-app.replit.app";
      const actionLine = report.actionDirection ? `\n조치 방향: ${report.actionDirection}` : "";

      // 귀책 부서 조회 (QC 메시지 + 부서 알림 공통 사용)
      let deptName: string | null = null;
      let deptWebhookUrl: string | null = null;
      if (report.deptCd) {
        const [dept] = await db
          .select({ webhookUrl: departmentsTable.webhookUrl, deptName: departmentsTable.deptName })
          .from(departmentsTable)
          .where(eq(departmentsTable.deptCd, report.deptCd));
        deptName = dept?.deptName ?? null;
        deptWebhookUrl = dept?.webhookUrl ?? null;
      }

      const deptLine = deptName ? `\n귀책 부서: ${deptName}` : "";
      const qcText = `부적합 보고서 접수\n품목: ${report.itemCode}${actionLine}${deptLine}\n링크: ${appUrl}/admin?reportId=${report.id}`;
      const sentAt = new Date();
      await sendSushantalkMessage(channel, qcText);
      await db
        .update(nonConformityReportsTable)
        .set({
          ssushanTalkSentAt: sentAt,
          ...(channel === "lab" ? { labNotifiedAt: sentAt } : {}),
        })
        .where(eq(nonConformityReportsTable.id, report.id));
      req.log.info({ reportId: report.id, channel }, "Sushantalk QC message sent");

      // 귀책 부서 채널 알림 (webhookUrl 설정된 경우만)
      if (deptWebhookUrl) {
        const deptText = `[귀책 부서 알림] 부적합 보고서가 접수되었습니다.\n품목: ${report.itemCode}\n공정: ${report.processName}${actionLine}\n링크: ${appUrl}/admin?reportId=${report.id}`;
        await sendSushantalkToUrl(deptWebhookUrl, deptText);
        req.log.info({ reportId: report.id, deptCd: report.deptCd }, "Sushantalk dept message sent");
      }
    } catch (err) {
      req.log.error({ err, reportId: report.id }, "Sushantalk webhook failed (non-fatal)");
    }
  })();
});

router.get("/reports/stats", async (_req, res): Promise<void> => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [totalResult] = await db
    .select({ count: count() })
    .from(nonConformityReportsTable);

  const [recentResult] = await db
    .select({ count: count() })
    .from(nonConformityReportsTable)
    .where(gte(nonConformityReportsTable.createdAt, sevenDaysAgo));

  const byDefectType = await db
    .select({
      label: nonConformityReportsTable.defectType,
      count: count(),
    })
    .from(nonConformityReportsTable)
    .groupBy(nonConformityReportsTable.defectType)
    .orderBy(sql`count(*) DESC`);

  const bySyncStatus = await db
    .select({
      label: nonConformityReportsTable.syncStatus,
      count: count(),
    })
    .from(nonConformityReportsTable)
    .groupBy(nonConformityReportsTable.syncStatus);

  // V2.0: Lock 건수
  const [lockedResult] = await db
    .select({ count: count() })
    .from(nonConformityReportsTable)
    .where(eq(nonConformityReportsTable.isLocked, true));

  // V2.0: 개발품 중 랩 통보 미완료 건수 (labNotifiedAt IS NULL)
  const [pendingLabResult] = await db
    .select({ count: count() })
    .from(nonConformityReportsTable)
    .where(
      and(
        eq(nonConformityReportsTable.productType, "개발"),
        sql`${nonConformityReportsTable.labNotifiedAt} IS NULL`,
      ),
    );

  res.json({
    total: Number(totalResult?.count ?? 0),
    recentCount: Number(recentResult?.count ?? 0),
    byDefectType: byDefectType.map((r) => ({
      label: r.label,
      count: Number(r.count),
    })),
    bySyncStatus: bySyncStatus.map((r) => ({
      label: r.label,
      count: Number(r.count),
    })),
    lockedCount: Number(lockedResult?.count ?? 0),
    pendingLabCount: Number(pendingLabResult?.count ?? 0),
  });
});

router.get("/reports/pending", async (_req, res): Promise<void> => {
  const reports = await db
    .select()
    .from(nonConformityReportsTable)
    .where(eq(nonConformityReportsTable.syncStatus, "PENDING"))
    .orderBy(nonConformityReportsTable.createdAt);

  res.json(reports);
});

// Task #37: 집계 통계 API
router.get("/reports/summary", requireAuth, async (req, res): Promise<void> => {
  const from = typeof req.query.from === "string" && req.query.from ? new Date(req.query.from) : null;
  const to   = typeof req.query.to   === "string" && req.query.to   ? new Date(req.query.to)   : null;
  const vendorCd    = typeof req.query.vendorCd    === "string" && req.query.vendorCd    ? req.query.vendorCd    : null;
  const flawTypeCd  = typeof req.query.flawTypeCd  === "string" && req.query.flawTypeCd  ? req.query.flawTypeCd  : null;
  const qcStatusRaw = typeof req.query.qcStatus === "string" && req.query.qcStatus ? req.query.qcStatus : null;

  const conds: ReturnType<typeof eq>[] = [];
  if (from && !isNaN(from.getTime())) conds.push(gte(nonConformityReportsTable.reportDate, from));
  if (to   && !isNaN(to.getTime()))   conds.push(lte(nonConformityReportsTable.reportDate, to));
  if (vendorCd)   conds.push(eq(nonConformityReportsTable.vendorCd, vendorCd));
  if (flawTypeCd) conds.push(eq(nonConformityReportsTable.flawTypeCd, flawTypeCd));
  if (qcStatusRaw) conds.push(eq(nonConformityReportsTable.qcStatus, qcStatusRaw as "OPEN" | "IN_REVIEW" | "PENDING_COLLAB" | "RESOLVED" | "APPROVED" | "ERP_SYNCED"));
  const where = conds.length > 0 ? and(...conds) : undefined;

  const [byQcStatus, byFlawType, byVendor, totals] = await Promise.all([
    db.select({ status: nonConformityReportsTable.qcStatus, cnt: count() })
      .from(nonConformityReportsTable).where(where)
      .groupBy(nonConformityReportsTable.qcStatus),
    db.select({
      flawTypeCd: nonConformityReportsTable.flawTypeCd,
      cnt: count(),
      totalLostManHours: sql<number>`COALESCE(SUM(${nonConformityReportsTable.lostManHours}), 0)`,
    })
      .from(nonConformityReportsTable).where(where)
      .groupBy(nonConformityReportsTable.flawTypeCd)
      .orderBy(sql`count(*) DESC`),
    db.select({
      vendorCd: nonConformityReportsTable.vendorCd,
      vendorNm: nonConformityReportsTable.vendorNm,
      cnt: count(),
      totalLostManHours: sql<number>`COALESCE(SUM(${nonConformityReportsTable.lostManHours}), 0)`,
    })
      .from(nonConformityReportsTable).where(where)
      .groupBy(nonConformityReportsTable.vendorCd, nonConformityReportsTable.vendorNm)
      .orderBy(sql`count(*) DESC`),
    db.select({
      total: count(),
      totalLostManHours: sql<number>`COALESCE(SUM(${nonConformityReportsTable.lostManHours}), 0)`,
    })
      .from(nonConformityReportsTable).where(where),
  ]);

  res.json({
    total: Number(totals[0]?.total ?? 0),
    totalLostManHours: Number(totals[0]?.totalLostManHours ?? 0),
    byQcStatus: byQcStatus.map((r) => ({ status: r.status, count: Number(r.cnt) })),
    byFlawType: byFlawType.map((r) => ({ flawTypeCd: r.flawTypeCd, count: Number(r.cnt), totalLostManHours: Number(r.totalLostManHours) })),
    byVendor: byVendor.slice(0, 20).map((r) => ({ vendorCd: r.vendorCd, vendorNm: r.vendorNm, count: Number(r.cnt), totalLostManHours: Number(r.totalLostManHours) })),
  });
});

// Task #37: Excel 내보내기 API
router.get("/reports/export.xlsx", requireAuth, async (req, res): Promise<void> => {
  const from = typeof req.query.from === "string" && req.query.from ? new Date(req.query.from) : null;
  const to   = typeof req.query.to   === "string" && req.query.to   ? new Date(req.query.to)   : null;
  const vendorCd      = typeof req.query.vendorCd    === "string" && req.query.vendorCd    ? req.query.vendorCd    : null;
  const flawTypeCd    = typeof req.query.flawTypeCd  === "string" && req.query.flawTypeCd  ? req.query.flawTypeCd  : null;
  const qcStatusRaw   = typeof req.query.qcStatus    === "string" && req.query.qcStatus    ? req.query.qcStatus    : null;
  const syncStatusRaw = typeof req.query.syncStatus  === "string" && req.query.syncStatus  ? req.query.syncStatus  : null;

  const conds: ReturnType<typeof eq>[] = [];
  if (from && !isNaN(from.getTime())) conds.push(gte(nonConformityReportsTable.reportDate, from));
  if (to   && !isNaN(to.getTime()))   conds.push(lte(nonConformityReportsTable.reportDate, to));
  if (vendorCd)     conds.push(eq(nonConformityReportsTable.vendorCd, vendorCd));
  if (flawTypeCd)   conds.push(eq(nonConformityReportsTable.flawTypeCd, flawTypeCd));
  if (qcStatusRaw)  conds.push(eq(nonConformityReportsTable.qcStatus, qcStatusRaw as "OPEN" | "IN_REVIEW" | "PENDING_COLLAB" | "RESOLVED" | "APPROVED" | "ERP_SYNCED"));
  if (syncStatusRaw) conds.push(eq(nonConformityReportsTable.syncStatus, syncStatusRaw as "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"));
  const where = conds.length > 0 ? and(...conds) : undefined;

  const reports = await db
    .select()
    .from(nonConformityReportsTable)
    .where(where)
    .orderBy(sql`${nonConformityReportsTable.createdAt} DESC`);

  const QC_STATUS_KR: Record<string, string> = {
    OPEN: "접수", IN_REVIEW: "검토 중", PENDING_COLLAB: "협업 대기",
    RESOLVED: "조치 완료", APPROVED: "승인 완료", ERP_SYNCED: "ERP 등록",
  };

  const rows = reports.map((r) => ({
    "NCR 번호":       r.ncrNumber ?? "",
    "접수일시":        r.reportDate ? new Date(r.reportDate).toISOString().slice(0, 16).replace("T", " ") : "",
    "발생일":          r.occurrenceDate ? new Date(r.occurrenceDate).toISOString().slice(0, 10) : "",
    "품목코드":        r.itemCode,
    "모델명":          r.modelName ?? "",
    "거래처명":        r.vendorNm ?? "",
    "거래처코드":      r.vendorCd ?? "",
    "불량유형":        r.defectType ?? "",
    "불량유형코드":    r.flawTypeCd ?? "",
    "공정명":          r.processName ?? "",
    "공장":            r.factory ?? "",
    "등록자":          r.registrantName ?? "",
    "조치방향":        r.actionDirection ?? "",
    "QC상태":          r.qcStatus ? (QC_STATUS_KR[r.qcStatus] ?? r.qcStatus) : "",
    "손실공수(h)":     r.lostManHours ?? "",
    "불량수량":        r.defectQty ?? "",
    "귀책부서코드":    r.deptCd ?? "",
    "동기화상태":      r.syncStatus ?? "",
    "비고":            r.remarks ?? "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const colWidths = [14, 18, 12, 14, 16, 20, 14, 14, 14, 16, 8, 12, 16, 12, 12, 10, 12, 12, 20];
  ws["!cols"] = colWidths.map((w) => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "NCR 관리대장");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const now = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Disposition", `attachment; filename="ncr-export-${now}.xlsx"`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
});

router.get("/reports/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetReportParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [report] = await db
    .select()
    .from(nonConformityReportsTable)
    .where(eq(nonConformityReportsTable.id, params.data.id));

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  res.json(report);
});

router.patch("/reports/:id/sync-status", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateReportSyncStatusParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateReportSyncStatusBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const updates: Record<string, unknown> = { syncStatus: body.data.syncStatus };
  if (body.data.resetRetry) {
    updates.syncAttemptCount = 0;
    updates.syncNextRetryAt = null;
    updates.syncLastError = null;
  }

  const [report] = await db
    .update(nonConformityReportsTable)
    .set(updates)
    .where(eq(nonConformityReportsTable.id, params.data.id))
    .returning();

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  req.log.info(
    { reportId: report.id, syncStatus: report.syncStatus, resetRetry: body.data.resetRetry },
    "Report sync status updated",
  );
  res.json(report);
});

// V2.0: QC 조치 결과 확정 (admin 전용)
router.put("/reports/:id/qc", requireRole(["admin", "reviewer", "approver"]), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateReportQcParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateReportQcBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [existing] = await db
    .select({ id: nonConformityReportsTable.id })
    .from(nonConformityReportsTable)
    .where(eq(nonConformityReportsTable.id, params.data.id));

  if (!existing) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (body.data.itemCode !== undefined) updates.itemCode = body.data.itemCode;
  if (body.data.modelName !== undefined) updates.modelName = body.data.modelName;
  if (body.data.processName !== undefined) updates.processName = body.data.processName;
  if (body.data.processCd !== undefined) updates.processCd = body.data.processCd;
  if (body.data.plantCd !== undefined) updates.plantCd = body.data.plantCd;
  if (body.data.factory !== undefined) updates.factory = body.data.factory;
  if (body.data.registrantName !== undefined) updates.registrantName = body.data.registrantName;
  if (body.data.occurrenceDate !== undefined) updates.occurrenceDate = body.data.occurrenceDate ? new Date(body.data.occurrenceDate) : null;
  if (body.data.defectQty !== undefined) updates.defectQty = body.data.defectQty;
  if (body.data.description !== undefined) updates.description = body.data.description;
  if (body.data.actionDirection !== undefined) updates.actionDirection = body.data.actionDirection;
  if (body.data.shipmentUnit !== undefined) updates.shipmentUnit = body.data.shipmentUnit;
  if (body.data.flawTypeCd !== undefined) updates.flawTypeCd = body.data.flawTypeCd;
  if (body.data.lostManHours !== undefined) updates.lostManHours = body.data.lostManHours;
  if (body.data.qcCorrectiveResult !== undefined) updates.qcCorrectiveResult = body.data.qcCorrectiveResult;
  if (body.data.deptCd !== undefined) updates.deptCd = body.data.deptCd;
  if (body.data.issuingTeam !== undefined) updates.issuingTeam = body.data.issuingTeam;
  if (body.data.ncrGbnCd !== undefined) updates.ncrGbnCd = body.data.ncrGbnCd;
  if (body.data.vendorCd !== undefined) updates.vendorCd = body.data.vendorCd;
  if (body.data.vendorNm !== undefined) updates.vendorNm = body.data.vendorNm;
  if (body.data.remarks !== undefined) updates.remarks = body.data.remarks;
  if (body.data.shipmentDateFrom !== undefined) updates.shipmentDateFrom = body.data.shipmentDateFrom ? new Date(body.data.shipmentDateFrom) : null;
  if (body.data.shipmentDateTo !== undefined) updates.shipmentDateTo = body.data.shipmentDateTo ? new Date(body.data.shipmentDateTo) : null;
  if (body.data.managerCd !== undefined) updates.managerCd = body.data.managerCd;
  if (body.data.managerNm !== undefined) updates.managerNm = body.data.managerNm;
  // qcStatus는 PATCH /reports/:id/status 전용 — 여기서는 무시

  const [report] = await db
    .update(nonConformityReportsTable)
    .set(updates)
    .where(eq(nonConformityReportsTable.id, params.data.id))
    .returning();

  req.log.info({ reportId: report.id, qcStatus: report.qcStatus, by: req.auth!.userId }, "QC analysis saved");
  res.json(report);
});

router.post("/reports/:id/qc-action", requireRole(["admin", "reviewer", "approver"]), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = SubmitQcActionParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SubmitQcActionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [existing] = await db
    .select({ id: nonConformityReportsTable.id })
    .from(nonConformityReportsTable)
    .where(eq(nonConformityReportsTable.id, params.data.id));

  if (!existing) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  const [report] = await db
    .update(nonConformityReportsTable)
    .set({
      qcAction: body.data.qcAction,
      qcActionAt: new Date(),
      qcActionedBy: req.auth!.userId,
    })
    .where(eq(nonConformityReportsTable.id, params.data.id))
    .returning();

  req.log.info({ reportId: report.id, qcAction: report.qcAction, by: req.auth!.userId }, "QC action submitted");
  res.json(report);
});

router.put("/reports/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateReportParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateReportBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  // V2.0: Lock 가드 — isLocked=true인 보고서는 수정 불가
  const [existing] = await db
    .select({
      id: nonConformityReportsTable.id,
      isLocked: nonConformityReportsTable.isLocked,
      occurrenceDate: nonConformityReportsTable.occurrenceDate,
    })
    .from(nonConformityReportsTable)
    .where(eq(nonConformityReportsTable.id, params.data.id));

  if (!existing) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  if (existing.isLocked) {
    res.status(403).json({ error: "보고서가 잠금 상태입니다. SLA가 초과되어 수정이 제한됩니다." });
    return;
  }

  // Task #34: 발생일 기준 7일 경과 시 일반 사용자 수정 제한
  if (req.auth?.role !== "admin" && existing.occurrenceDate) {
    const elapsed = Date.now() - new Date(existing.occurrenceDate).getTime();
    if (elapsed > SEVEN_DAYS_MS) {
      res.status(403).json({ error: "발생일 기준 7일이 경과하여 수정이 제한됩니다. 관리자에게 문의하세요." });
      return;
    }
  }

  const updates: Record<string, unknown> = {};
  if (body.data.itemCode !== undefined) updates.itemCode = body.data.itemCode;
  if (body.data.modelName !== undefined) updates.modelName = body.data.modelName;
  if (body.data.processName !== undefined) updates.processName = body.data.processName;
  if (body.data.defectType !== undefined) updates.defectType = body.data.defectType;
  if (body.data.description !== undefined) updates.description = body.data.description;
  if (body.data.syncStatus !== undefined) updates.syncStatus = body.data.syncStatus;
  if (body.data.registrantName !== undefined) updates.registrantName = body.data.registrantName;
  if (body.data.ncrType !== undefined) updates.ncrType = body.data.ncrType;
  if (body.data.factory !== undefined) updates.factory = body.data.factory;
  if (body.data.shipmentUnit !== undefined) updates.shipmentUnit = body.data.shipmentUnit;
  if (body.data.lostManHours !== undefined) updates.lostManHours = body.data.lostManHours;
  if (body.data.defectQty !== undefined) updates.defectQty = body.data.defectQty;
  if (body.data.occurrenceDate !== undefined) updates.occurrenceDate = body.data.occurrenceDate;
  if (body.data.issuingTeam !== undefined) updates.issuingTeam = body.data.issuingTeam;
  if (body.data.plantCd !== undefined) updates.plantCd = body.data.plantCd;
  if (body.data.processCd !== undefined) updates.processCd = body.data.processCd;
  if (body.data.flawTypeCd !== undefined) updates.flawTypeCd = body.data.flawTypeCd;
  if (body.data.deptCd !== undefined) updates.deptCd = body.data.deptCd;
  if (body.data.ncrGbnCd !== undefined) updates.ncrGbnCd = body.data.ncrGbnCd;
  if (body.data.vendorCd !== undefined) updates.vendorCd = body.data.vendorCd;
  if (body.data.vendorNm !== undefined) updates.vendorNm = body.data.vendorNm;
  if (body.data.remarks !== undefined) updates.remarks = body.data.remarks;
  if (body.data.shipmentDateFrom !== undefined) updates.shipmentDateFrom = body.data.shipmentDateFrom ? new Date(body.data.shipmentDateFrom) : null;
  if (body.data.shipmentDateTo !== undefined) updates.shipmentDateTo = body.data.shipmentDateTo ? new Date(body.data.shipmentDateTo) : null;
  if (body.data.managerCd !== undefined) updates.managerCd = body.data.managerCd;
  if (body.data.managerNm !== undefined) updates.managerNm = body.data.managerNm;

  const [report] = await db
    .update(nonConformityReportsTable)
    .set(updates)
    .where(eq(nonConformityReportsTable.id, params.data.id))
    .returning();

  req.log.info({ reportId: report.id }, "Report updated");
  res.json(report);
});

// Task #34: 월 마감 API (admin 전용)
router.post("/admin/close-month", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CloseMonthBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { year, month } = parsed.data;

  // 해당 월까지(포함)의 모든 보고서 잠금 — 이전 월도 포함
  // cutoff = 다음 달 1일 (exclusive upper bound)
  const cutoff = new Date(year, month, 1);

  const result = await db
    .update(nonConformityReportsTable)
    .set({ isLocked: true })
    .where(
      and(
        eq(nonConformityReportsTable.isLocked, false),
        lt(nonConformityReportsTable.reportDate, cutoff),
      ),
    )
    .returning({ id: nonConformityReportsTable.id });

  req.log.info({ year, month, lockedCount: result.length, by: req.auth!.userId }, "Month closed");
  res.json({ lockedCount: result.length, year, month });
});

// Task #35: 역할 기반 QC 워크플로우 상태 전이 매트릭스
type QcStatus = "OPEN" | "IN_REVIEW" | "PENDING_COLLAB" | "RESOLVED" | "APPROVED" | "ERP_SYNCED";

// ERP_SYNCED는 RPA 성공 시 자동 전이만 허용 — 수동 전이 불가
// RESOLVED → APPROVED: approver 전용 (spec: "QC 팀장(approver)만 최종 승인")
// PENDING_COLLAB → RESOLVED: collaborator는 직접 종결 불가
const TRANSITION_MATRIX: Record<QcStatus, Partial<Record<QcStatus, UserRole[]>>> = {
  OPEN:           { IN_REVIEW: ["admin", "reviewer", "approver"] },
  IN_REVIEW:      { PENDING_COLLAB: ["admin", "reviewer"], RESOLVED: ["admin", "reviewer"], OPEN: ["admin"] },
  PENDING_COLLAB: { RESOLVED: ["admin", "reviewer"], IN_REVIEW: ["admin", "reviewer"] },
  RESOLVED:       { APPROVED: ["approver"], IN_REVIEW: ["admin", "reviewer"] },
  APPROVED:       {},
  ERP_SYNCED:     {},
};

const UpdateStatusBody = z.object({
  status: z.enum(["OPEN", "IN_REVIEW", "PENDING_COLLAB", "RESOLVED", "APPROVED", "ERP_SYNCED"]),
});

router.patch("/reports/:id/status", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "잘못된 ID" }); return; }

  const body = UpdateStatusBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [existing] = await db
    .select({ id: nonConformityReportsTable.id, qcStatus: nonConformityReportsTable.qcStatus })
    .from(nonConformityReportsTable)
    .where(eq(nonConformityReportsTable.id, id));

  if (!existing) { res.status(404).json({ error: "Report not found" }); return; }

  const from = (existing.qcStatus ?? "OPEN") as QcStatus;
  const to = body.data.status as QcStatus;
  const role = req.auth!.role as UserRole;

  if (from === to) { res.status(400).json({ error: "이미 해당 상태입니다" }); return; }

  const allowed = TRANSITION_MATRIX[from]?.[to];
  if (!allowed) {
    res.status(400).json({ error: `유효하지 않은 상태 전이입니다: ${from} → ${to}` });
    return;
  }
  if (!allowed.includes(role)) {
    res.status(403).json({ error: `이 전이(${from} → ${to})를 수행할 권한이 없습니다` });
    return;
  }

  const updates: Record<string, unknown> = { qcStatus: to };
  if (to === "APPROVED" || to === "RESOLVED") {
    updates.qcSubmittedAt = new Date();
    updates.qcSubmittedBy = req.auth!.userId;
  }

  const [report] = await db
    .update(nonConformityReportsTable)
    .set(updates)
    .where(eq(nonConformityReportsTable.id, id))
    .returning();

  req.log.info({ reportId: id, from, to, by: req.auth!.userId, role }, "QC status transitioned");
  res.json(report);
});

router.delete("/reports/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteReportParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(nonConformityReportsTable)
    .where(eq(nonConformityReportsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  req.log.info({ reportId: params.data.id }, "Report deleted");
  res.status(204).send();
});

export default router;

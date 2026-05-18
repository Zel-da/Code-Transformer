import { Router, type IRouter } from "express";
import { eq, sql, and, gte, lte, count } from "drizzle-orm";
import { db, nonConformityReportsTable } from "@workspace/db";
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
} from "@workspace/api-zod";
import { requireAdmin, requireAuth } from "../middleware/requireAuth.js";
import { sendSushantalkMessage } from "../lib/sushantalk.js";

const router: IRouter = Router();

router.get("/reports", async (req, res): Promise<void> => {
  const parsed = ListReportsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { defectType, syncStatus, dateFrom, dateTo, page, pageSize } =
    parsed.data;

  const conditions = [];
  if (defectType) {
    conditions.push(eq(nonConformityReportsTable.defectType, defectType));
  }
  if (syncStatus) {
    conditions.push(eq(nonConformityReportsTable.syncStatus, syncStatus as "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"));
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

  const [report] = await db
    .insert(nonConformityReportsTable)
    .values({
      reportDate,
      itemCode: d.itemCode,
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
      productType: d.productType ?? null,
      slaDeadlineAt,
    })
    .returning();

  req.log.info({ reportId: report.id, productType: report.productType }, "Non-conformity report created");
  res.status(201).json(report);

  // Fire-and-forget: 수산톡 웹훅 비동기 발송 (클라이언트 대기 없음)
  (async () => {
    try {
      const channel = report.productType === "개발" ? "lab" : "qc";
      const appUrl = process.env.APP_URL ?? "https://your-app.replit.app";
      const text = `부적합 보고서 접수\n품목: ${report.itemCode}\n링크: ${appUrl}/admin?reportId=${report.id}`;
      const sentAt = new Date();
      await sendSushantalkMessage(channel, text);
      await db
        .update(nonConformityReportsTable)
        .set({
          ssushanTalkSentAt: sentAt,
          ...(channel === "lab" ? { labNotifiedAt: sentAt } : {}),
        })
        .where(eq(nonConformityReportsTable.id, report.id));
      req.log.info({ reportId: report.id, channel }, "Sushantalk message sent");
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

  const [report] = await db
    .update(nonConformityReportsTable)
    .set({ syncStatus: body.data.syncStatus })
    .where(eq(nonConformityReportsTable.id, params.data.id))
    .returning();

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  req.log.info(
    { reportId: report.id, syncStatus: report.syncStatus },
    "Report sync status updated",
  );
  res.json(report);
});

// V2.0: QC 조치 결과 확정 (admin 전용)
router.post("/reports/:id/qc-action", requireAdmin, async (req, res): Promise<void> => {
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
    .select({ id: nonConformityReportsTable.id, isLocked: nonConformityReportsTable.isLocked })
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

  const updates: Record<string, unknown> = {};
  if (body.data.itemCode !== undefined) updates.itemCode = body.data.itemCode;
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

  const [report] = await db
    .update(nonConformityReportsTable)
    .set(updates)
    .where(eq(nonConformityReportsTable.id, params.data.id))
    .returning();

  req.log.info({ reportId: report.id }, "Report updated");
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

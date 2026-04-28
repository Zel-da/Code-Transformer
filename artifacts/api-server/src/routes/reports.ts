import { Router, type IRouter } from "express";
import { eq, sql, and, gte, lte, count } from "drizzle-orm";
import { db, nonConformityReportsTable } from "@workspace/db";
import {
  ListReportsQueryParams,
  CreateReportBody,
  GetReportParams,
  UpdateReportSyncStatusParams,
  UpdateReportSyncStatusBody,
} from "@workspace/api-zod";

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
    conditions.push(eq(nonConformityReportsTable.syncStatus, syncStatus));
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

  const [report] = await db
    .insert(nonConformityReportsTable)
    .values({
      reportDate: parsed.data.reportDate ?? new Date(),
      itemCode: parsed.data.itemCode,
      processName: parsed.data.processName,
      defectType: parsed.data.defectType,
      description: parsed.data.description,
      imageUrl: parsed.data.imageUrl ?? null,
      syncStatus: "PENDING",
    })
    .returning();

  req.log.info({ reportId: report.id }, "Non-conformity report created");
  res.status(201).json(report);
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

export default router;

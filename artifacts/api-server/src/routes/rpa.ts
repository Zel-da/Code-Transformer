import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, nonConformityReportsTable } from "@workspace/db";

const router: IRouter = Router();

router.post("/rpa/trigger", async (req, res): Promise<void> => {
  const pending = await db
    .select()
    .from(nonConformityReportsTable)
    .where(eq(nonConformityReportsTable.syncStatus, "PENDING"))
    .orderBy(nonConformityReportsTable.createdAt);

  if (pending.length === 0) {
    res.json({ processed: 0, completed: 0, failed: 0, reports: [] });
    return;
  }

  const results = [];
  let completed = 0;
  let failed = 0;

  for (const report of pending) {
    await db
      .update(nonConformityReportsTable)
      .set({ syncStatus: "PROCESSING" })
      .where(eq(nonConformityReportsTable.id, report.id));

    const success = Math.random() > 0.1;
    const finalStatus = success ? "COMPLETED" : "FAILED";

    const [updated] = await db
      .update(nonConformityReportsTable)
      .set({ syncStatus: finalStatus })
      .where(eq(nonConformityReportsTable.id, report.id))
      .returning();

    if (updated) {
      results.push(updated);
      if (finalStatus === "COMPLETED") completed++;
      else failed++;
    }

    req.log.info({ reportId: report.id, syncStatus: finalStatus }, "RPA processed report");
  }

  res.json({
    processed: pending.length,
    completed,
    failed,
    reports: results,
  });
});

export default router;

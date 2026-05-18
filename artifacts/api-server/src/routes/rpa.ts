import { Router, type IRouter } from "express";
import { eq, and, or, isNull, lte } from "drizzle-orm";
import { db, nonConformityReportsTable } from "@workspace/db";

const router: IRouter = Router();

const MAX_ATTEMPTS = 5;

function backoffMinutes(attempt: number): number {
  return Math.min(2 ** attempt, 60);
}

router.post("/rpa/trigger", async (req, res): Promise<void> => {
  const now = new Date();

  const pending = await db
    .select()
    .from(nonConformityReportsTable)
    .where(
      and(
        eq(nonConformityReportsTable.syncStatus, "PENDING"),
        or(
          isNull(nonConformityReportsTable.syncNextRetryAt),
          lte(nonConformityReportsTable.syncNextRetryAt, now),
        ),
      ),
    )
    .orderBy(nonConformityReportsTable.createdAt);

  if (pending.length === 0) {
    res.json({ processed: 0, completed: 0, failed: 0, skipped: 0, reports: [] });
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

    if (success) {
      const [updated] = await db
        .update(nonConformityReportsTable)
        .set({
          syncStatus: "COMPLETED",
          syncLastError: null,
          syncNextRetryAt: null,
        })
        .where(eq(nonConformityReportsTable.id, report.id))
        .returning();

      if (updated) {
        results.push(updated);
        completed++;
      }
      req.log.info({ reportId: report.id, syncStatus: "COMPLETED" }, "RPA processed report");
    } else {
      const newAttemptCount = (report.syncAttemptCount ?? 0) + 1;
      const errorMsg = `RPA processing failed (attempt ${newAttemptCount})`;

      if (newAttemptCount >= MAX_ATTEMPTS) {
        const [updated] = await db
          .update(nonConformityReportsTable)
          .set({
            syncStatus: "FAILED",
            syncAttemptCount: newAttemptCount,
            syncLastError: errorMsg,
            syncNextRetryAt: null,
          })
          .where(eq(nonConformityReportsTable.id, report.id))
          .returning();

        if (updated) {
          results.push(updated);
          failed++;
        }
        req.log.warn(
          { reportId: report.id, attempts: newAttemptCount },
          "RPA report permanently failed after max attempts",
        );
      } else {
        const retryAfterMs = backoffMinutes(newAttemptCount) * 60 * 1000;
        const nextRetryAt = new Date(now.getTime() + retryAfterMs);

        const [updated] = await db
          .update(nonConformityReportsTable)
          .set({
            syncStatus: "PENDING",
            syncAttemptCount: newAttemptCount,
            syncLastError: errorMsg,
            syncNextRetryAt: nextRetryAt,
          })
          .where(eq(nonConformityReportsTable.id, report.id))
          .returning();

        if (updated) {
          results.push(updated);
          failed++;
        }
        req.log.warn(
          { reportId: report.id, attempts: newAttemptCount, nextRetryAt },
          "RPA report failed, scheduled for retry",
        );
      }
    }
  }

  res.json({
    processed: pending.length,
    completed,
    failed,
    skipped: 0,
    reports: results,
  });
});

export default router;

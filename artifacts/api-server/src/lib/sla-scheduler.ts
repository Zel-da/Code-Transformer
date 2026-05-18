import { db, nonConformityReportsTable } from "@workspace/db";
import { and, eq, lt, isNull, inArray } from "drizzle-orm";
import { logger } from "./logger.js";

const INTERVAL_MS = 5 * 60 * 1000;

async function runSlaCheck(): Promise<void> {
  try {
    const now = new Date();

    const expired = await db
      .select({ id: nonConformityReportsTable.id })
      .from(nonConformityReportsTable)
      .where(
        and(
          lt(nonConformityReportsTable.slaDeadlineAt, now),
          eq(nonConformityReportsTable.isLocked, false),
          isNull(nonConformityReportsTable.qcAction),
        ),
      );

    if (expired.length === 0) {
      logger.debug("SLA check: no expired reports");
      return;
    }

    const ids = expired.map((r) => r.id);
    await db
      .update(nonConformityReportsTable)
      .set({ isLocked: true })
      .where(inArray(nonConformityReportsTable.id, ids));

    logger.info({ count: ids.length, ids }, `SLA scheduler: locked ${ids.length} expired report(s)`);
  } catch (err) {
    logger.error({ err }, "SLA scheduler: error during check");
  }
}

export function startSlaScheduler(): void {
  logger.info("SLA scheduler started (interval: 5 min)");
  runSlaCheck();
  setInterval(runSlaCheck, INTERVAL_MS);
}

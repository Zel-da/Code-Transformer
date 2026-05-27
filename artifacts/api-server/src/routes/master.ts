import { Router, type IRouter } from "express";
import {
  db,
  plantsTable,
  flawTypesTable,
  processesTable,
  dispositionsTable,
  departmentsTable,
} from "@workspace/db";
import { eq, asc, ilike, desc } from "drizzle-orm";
import { requireAdmin } from "../middleware/requireAuth.js";

const router: IRouter = Router();

router.get("/master/plants", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(plantsTable)
    .orderBy(asc(plantsTable.plantCd));
  res.json(rows);
});

router.get("/master/flaw-types", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(flawTypesTable)
    .orderBy(asc(flawTypesTable.sortIndex), asc(flawTypesTable.typeCd));
  res.json(rows);
});

router.get("/master/processes", async (req, res): Promise<void> => {
  const { plantCd } = req.query as { plantCd?: string };
  const rows = plantCd
    ? await db
        .select()
        .from(processesTable)
        .where(eq(processesTable.plantCd, plantCd))
        .orderBy(asc(processesTable.processCd))
    : await db
        .select()
        .from(processesTable)
        .orderBy(asc(processesTable.plantCd), asc(processesTable.processCd));
  res.json(rows);
});

router.get("/master/dispositions", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(dispositionsTable)
    .orderBy(asc(dispositionsTable.dispositionCd));
  res.json(rows);
});

router.get("/master/departments", async (req, res): Promise<void> => {
  const { search } = req.query as { search?: string };
  const rows = search
    ? await db
        .select()
        .from(departmentsTable)
        .where(ilike(departmentsTable.deptName, `%${search}%`))
        .orderBy(desc(departmentsTable.isFrequent), asc(departmentsTable.deptName))
    : await db
        .select()
        .from(departmentsTable)
        .orderBy(desc(departmentsTable.isFrequent), asc(departmentsTable.deptName));
  res.json(rows);
});

router.patch("/master/departments/:deptCd", requireAdmin, async (req, res): Promise<void> => {
  const deptCd = String(req.params.deptCd);
  const { webhookUrl } = req.body as { webhookUrl?: string | null };

  const [existing] = await db
    .select({ deptCd: departmentsTable.deptCd })
    .from(departmentsTable)
    .where(eq(departmentsTable.deptCd, deptCd));

  if (!existing) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  const [updated] = await db
    .update(departmentsTable)
    .set({ webhookUrl: webhookUrl ?? null })
    .where(eq(departmentsTable.deptCd, deptCd))
    .returning();

  req.log.info({ deptCd, hasWebhook: !!webhookUrl }, "Department webhook updated");
  res.json(updated);
});

export default router;

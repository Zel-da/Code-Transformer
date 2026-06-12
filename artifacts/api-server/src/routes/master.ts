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
import { sendSushantalkToUrl } from "../lib/sushantalk.js";

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

router.post("/master/departments/:deptCd/test-webhook", requireAdmin, async (req, res): Promise<void> => {
  const deptCd = String(req.params.deptCd);

  const [dept] = await db
    .select()
    .from(departmentsTable)
    .where(eq(departmentsTable.deptCd, deptCd));

  if (!dept) {
    res.status(404).json({ error: "부서를 찾을 수 없습니다" });
    return;
  }
  if (!dept.webhookUrl) {
    res.status(400).json({ error: "Webhook URL이 설정되지 않았습니다. 먼저 저장하세요." });
    return;
  }

  try {
    await sendSushantalkToUrl(
      dept.webhookUrl,
      `[✅ 테스트] 안녕하세요!\n부적합 보고 시스템 Webhook 연동 테스트입니다.\n${dept.deptName} 채널이 정상 연결되었습니다.`,
    );
    req.log.info({ deptCd }, "Webhook test sent successfully");
    res.json({ ok: true, message: "테스트 메시지를 발송했습니다" });
  } catch (err) {
    req.log.warn({ err, deptCd }, "Webhook test failed");
    res.status(502).json({ error: "Webhook 발송 실패", detail: String(err) });
  }
});

export default router;

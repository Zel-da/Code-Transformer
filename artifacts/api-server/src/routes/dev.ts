import { Router } from "express";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, usersTable, nonConformityReportsTable } from "@workspace/db";
import { logger as rootLogger } from "../lib/logger.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
const log = rootLogger.child({ fn: "dev-simulator" });

/**
 * POST /dev/simulate-ncr-button
 * 수산톡 버튼 클릭을 시뮬레이션한다 (admin 전용).
 * 서버에서 HMAC 서명을 생성하고 웹훅 콜백을 내부 self-call로 실행한다.
 */
router.post("/dev/simulate-ncr-button", requireAuth, async (req, res): Promise<void> => {
  if ((req as any).auth?.role !== "admin") {
    res.status(403).json({ error: "관리자 권한이 필요합니다" });
    return;
  }

  const { reportId, targetStatus, email } = req.body as {
    reportId?: number;
    targetStatus?: string;
    email?: string;
  };

  if (!reportId || !targetStatus || !email) {
    res.status(400).json({ error: "reportId, targetStatus, email 은 필수입니다" });
    return;
  }

  const secret = process.env.NCR_WEBHOOK_SECRET ?? "";
  if (!secret) {
    res.status(500).json({ error: "NCR_WEBHOOK_SECRET 미설정" });
    return;
  }

  // 1. 보고서 + 사용자 조회
  const [[report], [actor]] = await Promise.all([
    db.select().from(nonConformityReportsTable).where(eq(nonConformityReportsTable.id, reportId)),
    db.select().from(usersTable).where(eq(usersTable.email, email)),
  ]);

  if (!report) {
    res.status(404).json({ error: `보고서 #${reportId}를 찾을 수 없습니다` });
    return;
  }
  if (!actor) {
    res.status(404).json({ error: `${email} 사용자를 찾을 수 없습니다` });
    return;
  }

  const from = report.qcStatus ?? "OPEN";

  // 2. HMAC 서명 생성
  const sig = createHmac("sha256", secret)
    .update(`${reportId}:${targetStatus}`)
    .digest("hex")
    .slice(0, 10);
  const value = `${targetStatus}:${reportId}:${sig}`;

  // 3. 웹훅 엔드포인트 내부 self-call
  const baseUrl = `http://localhost:${process.env.PORT ?? 8080}`;
  try {
    await fetch(`${baseUrl}/api/webhooks/ncr-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        value,
        email,
        name: actor.displayName ?? actor.username,
        triggeredAt: new Date().toISOString(),
      }),
    });
  } catch (err) {
    log.error({ err }, "self-call failed");
    res.status(500).json({ error: "내부 웹훅 호출 실패" });
    return;
  }

  // 웹훅은 비동기(setImmediate) 처리이므로 잠깐 대기 후 상태 재조회
  await new Promise((r) => setTimeout(r, 800));

  const [updated] = await db
    .select({ qcStatus: nonConformityReportsTable.qcStatus })
    .from(nonConformityReportsTable)
    .where(eq(nonConformityReportsTable.id, reportId));

  const to = updated?.qcStatus ?? from;
  const transitioned = to !== from;

  log.info({ reportId, from, to, email, transitioned }, "simulation complete");

  res.json({
    ok: transitioned,
    from,
    to,
    message: transitioned
      ? `✅ ${from} → ${to} 전이 성공`
      : `⚠️ 전이되지 않았습니다. 현재 상태: ${from} — 권한 또는 매트릭스를 확인하세요.`,
  });
});

export default router;

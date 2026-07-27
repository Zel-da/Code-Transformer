import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
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

/**
 * POST /dev/seed-users
 * 특장사업본부 인원을 DB에 등록한다 (없는 계정만).
 * Authorization: Bearer <SEED_TOKEN> 으로 보호된다.
 */
router.post("/dev/seed-users", async (req, res): Promise<void> => {
  const token = process.env.SEED_TOKEN;
  if (!token) {
    res.status(503).json({ error: "SEED_TOKEN 미설정" });
    return;
  }
  const provided = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  try {
    if (!timingSafeEqual(Buffer.from(token), Buffer.from(provided))) throw new Error();
  } catch {
    res.status(401).json({ error: "인증 실패" });
    return;
  }

  const USERS = [
    { username: "iloveji0",     email: "iloveji0@soosan.co.kr",     displayName: "문상보", deptCd: "A4CSH21100000", role: "worker" as const },
    { username: "493086",       email: "493086@soosan.co.kr",       displayName: "최용규", deptCd: "A4CSH21100000", role: "worker" as const },
    { username: "azecom",       email: "azecom@soosan.co.kr",       displayName: "김영준", deptCd: "A4CSH24103000", role: "worker" as const },
    { username: "hn.yoon",      email: "hn.yoon@soosan.co.kr",      displayName: "윤홍노", deptCd: "A4CSH24103000", role: "worker" as const },
    { username: "hr.kim",       email: "hr.kim@soosan.co.kr",       displayName: "김홍래", deptCd: "A4CSH24103000", role: "worker" as const },
    { username: "lds124k",      email: "lds124k@soosan.co.kr",      displayName: "이대성", deptCd: "A4CSH24103000", role: "worker" as const },
    { username: "wj.lee",       email: "wj.lee@soosan.co.kr",       displayName: "이원진", deptCd: "A4CSH24103000", role: "worker" as const },
    { username: "jh.choi3",     email: "jh.choi3@soosan.co.kr",     displayName: "최지혜", deptCd: "A4CSH24103000", role: "worker" as const },
    { username: "sw.lee",       email: "sw.lee@soosan.co.kr",       displayName: "이세원", deptCd: "A4CSH24104000", role: "worker" as const },
    { username: "dlqudgns2504", email: "dlqudgns2504@soosan.co.kr", displayName: "이병훈", deptCd: "A4CSH24104000", role: "worker" as const },
    { username: "yoonsuk",      email: "yoonsuk@soosan.co.kr",      displayName: "이윤석", deptCd: "A4CSH24104000", role: "worker" as const },
    { username: "hk.lee",       email: "hk.lee@soosan.co.kr",       displayName: "이헌권", deptCd: "A4CSH24104000", role: "worker" as const },
  ];

  const DEFAULT_PW = "soosan2024!";
  const passwordHash = await bcrypt.hash(DEFAULT_PW, 10);

  const results: { username: string; status: string }[] = [];

  for (const u of USERS) {
    const [existing] = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, u.email));

    if (existing) {
      results.push({ username: u.username, status: "skipped (already exists)" });
      continue;
    }

    try {
      await db.insert(usersTable).values({ ...u, passwordHash, isActive: true, notifyLevel: "to" });
      results.push({ username: u.username, status: "created" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ username: u.username, status: `error: ${msg}` });
    }
  }

  res.json({ ok: true, results });
});

export default router;

import { Router } from "express";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, usersTable, nonConformityReportsTable } from "@workspace/db";
import { logger as rootLogger } from "../lib/logger.js";
import { notifyStatusTransition } from "../lib/notifications.js";
import { writeAuditLog } from "../lib/audit.js";

const router = Router();

type QcStatus = "OPEN" | "IN_REVIEW" | "PENDING_COLLAB" | "RESOLVED" | "APPROVED" | "ERP_SYNCED";
type UserRole = "admin" | "worker" | "reviewer" | "approver" | "collaborator";

const TRANSITION_MATRIX: Record<QcStatus, Partial<Record<QcStatus, UserRole[]>>> = {
  OPEN:           { IN_REVIEW: ["admin", "reviewer", "approver"] },
  IN_REVIEW:      { PENDING_COLLAB: ["admin", "reviewer"], RESOLVED: ["admin", "reviewer"], OPEN: ["admin"] },
  PENDING_COLLAB: { RESOLVED: ["admin", "reviewer"], IN_REVIEW: ["admin", "reviewer"] },
  RESOLVED:       { APPROVED: ["approver"], IN_REVIEW: ["admin", "reviewer"] },
  APPROVED:       {},
  ERP_SYNCED:     {},
};

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex").slice(0, 10);
}

/**
 * POST /webhooks/ncr-action
 * 수산톡 버튼 클릭 콜백 수신 → QC 상태 전이 처리
 *
 * value 포맷: "{targetStatus}:{reportId}:{hmac10}"
 * 예: "APPROVED:42:a1b2c3d4e5"
 */
router.post("/webhooks/ncr-action", async (req, res): Promise<void> => {
  res.sendStatus(200);

  const log = rootLogger.child({ fn: "ncr-action-webhook" });

  setImmediate(async () => {
    try {
      const { value, email, name, triggeredAt } = req.body as {
        value?: string;
        email?: string;
        name?: string;
        triggeredAt?: string;
      };

      if (!value || !email) {
        log.warn({ body: req.body }, "ncr-action: missing value or email");
        return;
      }

      // 1. value 파싱: "APPROVED:42:a1b2c3d4e5"
      const parts = value.split(":");
      if (parts.length !== 3) {
        log.warn({ value }, "ncr-action: malformed value");
        return;
      }
      const [targetStatus, reportIdStr, receivedSig] = parts;
      const reportId = Number(reportIdStr);
      if (isNaN(reportId)) {
        log.warn({ reportIdStr }, "ncr-action: invalid reportId");
        return;
      }

      // 2. HMAC 서명 검증 (위변조 방지)
      const secret = process.env.NCR_WEBHOOK_SECRET ?? "";
      if (!secret) {
        log.error("ncr-action: NCR_WEBHOOK_SECRET not configured — rejecting all callbacks");
        return;
      }
      const expectedSig = sign(`${reportId}:${targetStatus}`, secret);
      if (receivedSig !== expectedSig) {
        log.warn({ reportId, targetStatus }, "ncr-action: HMAC signature mismatch, ignoring");
        return;
      }

      // 3. 클릭한 사용자 조회
      const [actor] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, email));

      if (!actor) {
        log.warn({ email }, "ncr-action: user not found by email");
        return;
      }
      if (!actor.isActive) {
        log.warn({ email }, "ncr-action: user is inactive");
        return;
      }

      // 4. 보고서 조회
      const [report] = await db
        .select()
        .from(nonConformityReportsTable)
        .where(eq(nonConformityReportsTable.id, reportId));

      if (!report) {
        log.warn({ reportId }, "ncr-action: report not found");
        return;
      }

      const from = (report.qcStatus ?? "OPEN") as QcStatus;
      const to = targetStatus as QcStatus;

      if (from === to) {
        log.info({ reportId, from }, "ncr-action: already in target status, skipping");
        return;
      }

      // 5. 전이 권한 확인
      const allowed = TRANSITION_MATRIX[from]?.[to];
      if (!allowed) {
        log.warn({ from, to }, "ncr-action: invalid transition");
        return;
      }
      if (!allowed.includes(actor.role as UserRole)) {
        log.warn({ from, to, role: actor.role, email }, "ncr-action: unauthorized role for transition");
        return;
      }

      // 6. 상태 전이 실행
      const updates: Record<string, unknown> = { qcStatus: to };
      if (to === "APPROVED" || to === "RESOLVED") {
        updates.qcSubmittedAt = new Date();
        updates.qcSubmittedBy = actor.id;
      }

      const [updated] = await db
        .update(nonConformityReportsTable)
        .set(updates)
        .where(eq(nonConformityReportsTable.id, reportId))
        .returning();

      // 7. 감사 로그
      await writeAuditLog({
        actorId: actor.id,
        actorName: name ?? actor.displayName ?? email,
        action: "STATUS_CHANGED",
        targetType: "report",
        targetId: reportId,
        before: { qcStatus: from },
        after: { qcStatus: to },
        detail: `수산톡 버튼 클릭: ${from} → ${to} (${email})`,
      });

      log.info({ reportId, from, to, email }, "ncr-action: QC status transitioned via Sushantalk button");

      // 8. 후속 알림 발송
      await notifyStatusTransition({ report: updated, from, to });
    } catch (err) {
      log.error({ err }, "ncr-action: unhandled error");
    }
  });
});

export default router;

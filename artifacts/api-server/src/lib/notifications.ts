import { eq, inArray, desc, and } from "drizzle-orm";
import { db, usersTable, departmentsTable, reportCommentsTable } from "@workspace/db";
import type { NonConformityReport } from "@workspace/db";
import {
  sendSushantalkToUrl,
  sendSushantalkMessage,
  sendBulkDm,
  isPatConfigured,
  type SushantalkRecipient,
} from "./sushantalk.js";
import { logger as rootLogger } from "./logger.js";

type QcStatus = "OPEN" | "IN_REVIEW" | "PENDING_COLLAB" | "RESOLVED" | "APPROVED" | "ERP_SYNCED";
type UserRole = "admin" | "worker" | "reviewer" | "approver" | "collaborator";

/**
 * 상태별 역할 기반 라우팅 매핑 (業務要件)
 *
 * OPEN          → QC담당자(reviewer/approver) = To,  구매/생산팀장(admin) = CC
 * IN_REVIEW     → 등록자(귀책부서 webhook) = To,     QC(reviewer/approver) = CC
 * PENDING_COLLAB → @tagged 담당자 = To (자동 조회)
 * RESOLVED      → 승인자(approver) = To,             QC/admin = CC
 * APPROVED      → RPA담당자(admin) = To,              등록자(귀책부서 webhook)+QC = CC
 * ERP_SYNCED    → 등록자(귀책부서 webhook)+QC = To
 */
const STATUS_ROUTING: Record<QcStatus, { toRoles: UserRole[]; ccRoles: UserRole[] }> = {
  OPEN:           { toRoles: ["reviewer", "approver"], ccRoles: ["admin"] },
  IN_REVIEW:      { toRoles: [],                       ccRoles: ["reviewer", "approver"] },
  PENDING_COLLAB: { toRoles: [],                       ccRoles: [] },
  RESOLVED:       { toRoles: ["approver"],              ccRoles: ["reviewer", "admin"] },
  APPROVED:       { toRoles: ["admin"],                 ccRoles: ["reviewer", "approver"] },
  ERP_SYNCED:     { toRoles: ["reviewer", "approver"], ccRoles: [] },
};

const STATUS_LABELS: Record<QcStatus, string> = {
  OPEN:           "부적합 접수",
  IN_REVIEW:      "QC 검토 시작",
  PENDING_COLLAB: "협업 요청",
  RESOLVED:       "조치 완료",
  APPROVED:       "승인 완료",
  ERP_SYNCED:     "ERP 등록 완료",
};

const BOT_NAME = "부적합 보고 시스템";
const ROOM_NAME = "🔔 NCR 알림";

// ────────────────────────────────────────────────────────────────
// Message builders
// ────────────────────────────────────────────────────────────────

function buildToMessage(report: NonConformityReport, to: QcStatus, appUrl: string): string {
  const label = STATUS_LABELS[to] ?? to;
  const ncr = report.ncrNumber ?? `#${report.id}`;
  const link = `${appUrl}/ledger?reportId=${report.id}`;
  const lines: string[] = [`[${label}] ${ncr}`];
  lines.push(`품목: ${report.itemCode}`);
  if (report.processName) lines.push(`공정: ${report.processName}`);
  if (report.registrantName) lines.push(`등록자: ${report.registrantName}`);
  if (report.actionDirection) lines.push(`조치 방향: ${report.actionDirection}`);
  lines.push(`링크: ${link}`);
  return lines.join("\n");
}

function buildCcMessage(
  report: NonConformityReport,
  from: QcStatus | null,
  to: QcStatus,
  appUrl: string,
): string {
  const ncr = report.ncrNumber ?? `#${report.id}`;
  const link = `${appUrl}/ledger?reportId=${report.id}`;
  const fromLabel = from ? (STATUS_LABELS[from] ?? from) : "신규";
  const toLabel = STATUS_LABELS[to] ?? to;
  return `[참조] ${ncr} 상태 변경: ${fromLabel} → ${toLabel}\n품목: ${report.itemCode}\n링크: ${link}`;
}

// ────────────────────────────────────────────────────────────────
// Dept webhook helper (cached per call)
// ────────────────────────────────────────────────────────────────

async function getDeptWebhook(
  deptCd: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (cache.has(deptCd)) return cache.get(deptCd)!;
  const [dept] = await db
    .select({ webhookUrl: departmentsTable.webhookUrl })
    .from(departmentsTable)
    .where(eq(departmentsTable.deptCd, deptCd));
  const url = dept?.webhookUrl ?? null;
  cache.set(deptCd, url);
  return url;
}

// ────────────────────────────────────────────────────────────────
// Fetch tagged users from latest PENDING_COLLAB comment
// ────────────────────────────────────────────────────────────────

async function fetchTaggedUserIds(reportId: number): Promise<number[]> {
  const [comment] = await db
    .select({ taggedUserIds: reportCommentsTable.taggedUserIds })
    .from(reportCommentsTable)
    .where(
      and(
        eq(reportCommentsTable.reportId, reportId),
      ),
    )
    .orderBy(desc(reportCommentsTable.createdAt))
    .limit(1);

  return comment?.taggedUserIds ?? [];
}

// ────────────────────────────────────────────────────────────────
// Main notification dispatcher
// ────────────────────────────────────────────────────────────────

/**
 * 상태 전이 시 지능형 알림 발송.
 *
 * PAT 토큰 설정 시 (SUSHANTALK_BASE_URL + SUSHANTALK_PAT_TOKEN):
 *   → 이메일이 등록된 사용자에게 개인 DM 직접 발송
 *   → 이메일 미등록 사용자는 기존 부서 webhook으로 fallback
 *
 * PAT 토큰 미설정 시:
 *   → 기존 방식(부서 webhook URL) 그대로 사용
 *
 * - To 수신자 (notifyLevel='to')  : 상세 메시지 수신
 * - CC 수신자 (notifyLevel='cc')  : 요약(참조) 메시지 수신
 * - notifyLevel='none'             : 알림 차단
 */
export async function notifyStatusTransition(opts: {
  report: NonConformityReport;
  from: QcStatus | null;
  to: QcStatus;
  taggedUserIds?: number[];
}): Promise<{ sentAt: Date | null; channel: string | null }> {
  const { report, from, to } = opts;
  const appUrl = process.env.APP_URL ?? "https://your-app.replit.app";
  const log = rootLogger.child({ fn: "notifyStatusTransition", reportId: report.id, to });
  const deptCache = new Map<string, string | null>();
  const usePat = isPatConfigured();

  try {
    const toMsg = buildToMessage(report, to, appUrl);
    const ccMsg = buildCcMessage(report, from, to, appUrl);

    // ── PAT 모드: 개인 DM 수신자 목록 ─────────────────────────
    const dmTo: SushantalkRecipient[] = [];
    const dmCc: SushantalkRecipient[] = [];

    // ── webhook fallback 수신자 ────────────────────────────────
    const webhookMap = new Map<string, { hasTo: boolean; hasCC: boolean }>();

    function accWebhook(url: string | null, isTo: boolean) {
      if (!url) return;
      const e = webhookMap.get(url) ?? { hasTo: false, hasCC: false };
      if (isTo) e.hasTo = true;
      else e.hasCC = true;
      webhookMap.set(url, e);
    }

    // ── 1. Resolve role-based recipients ───────────────────────
    const routing = STATUS_ROUTING[to];
    const allRoles = [...new Set([...routing.toRoles, ...routing.ccRoles])];

    if (allRoles.length > 0) {
      const activeUsers = await db
        .select({
          id: usersTable.id,
          role: usersTable.role,
          deptCd: usersTable.deptCd,
          email: usersTable.email,
          notifyLevel: usersTable.notifyLevel,
        })
        .from(usersTable)
        .where(eq(usersTable.isActive, true));

      const eligible = activeUsers.filter(
        (u) => allRoles.includes(u.role as UserRole) && u.notifyLevel !== "none",
      );

      for (const u of eligible) {
        const isTo =
          routing.toRoles.includes(u.role as UserRole) && u.notifyLevel === "to";
        const isCc =
          !isTo &&
          (routing.ccRoles.includes(u.role as UserRole) ||
            (routing.toRoles.includes(u.role as UserRole) && u.notifyLevel === "cc"));

        if (!isTo && !isCc) continue;

        if (usePat && u.email) {
          // 개인 DM 대상
          if (isTo) dmTo.push({ toEmail: u.email });
          else dmCc.push({ toEmail: u.email });
        } else {
          // webhook fallback
          if (!u.deptCd) continue;
          const url = await getDeptWebhook(u.deptCd, deptCache);
          accWebhook(url, isTo);
        }
      }
    }

    // ── 2. PENDING_COLLAB: tagged user 자동 조회 ───────────────
    if (to === "PENDING_COLLAB") {
      const taggedIds = opts.taggedUserIds?.length
        ? opts.taggedUserIds
        : await fetchTaggedUserIds(report.id);

      if (taggedIds.length > 0) {
        const taggedUsers = await db
          .select({
            id: usersTable.id,
            deptCd: usersTable.deptCd,
            email: usersTable.email,
            notifyLevel: usersTable.notifyLevel,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, taggedIds));

        for (const u of taggedUsers) {
          if (u.notifyLevel === "none") continue;
          const isTo = u.notifyLevel === "to";
          if (usePat && u.email) {
            if (isTo) dmTo.push({ toEmail: u.email });
            else dmCc.push({ toEmail: u.email });
          } else {
            if (!u.deptCd) continue;
            const url = await getDeptWebhook(u.deptCd, deptCache);
            accWebhook(url, isTo);
          }
        }
      }
    }

    // ── 3. 귀책부서 webhook — 등록자 대리 수신 ─────────────────
    // (부서 webhook 기반 고정: 개인 이메일 대신 부서 채널로 발송)
    if (report.deptCd && (to === "IN_REVIEW" || to === "APPROVED" || to === "ERP_SYNCED")) {
      const deptUrl = await getDeptWebhook(report.deptCd, deptCache);
      const isTo = to === "IN_REVIEW" || to === "ERP_SYNCED";
      accWebhook(deptUrl, isTo);
    }

    // ── 4. Dispatch ──────────────────────────────────────────
    const dispatches: Promise<unknown>[] = [];

    // 4a. PAT 개인 DM 발송
    if (usePat) {
      if (dmTo.length > 0) {
        dispatches.push(
          sendBulkDm({ recipients: dmTo, content: toMsg, botName: BOT_NAME, roomName: ROOM_NAME })
            .then(({ sent, failed }) => log.info({ sent, failed }, "PAT DM To sent"))
            .catch((e) => log.warn({ e }, "PAT bulk DM To failed")),
        );
      }
      if (dmCc.length > 0) {
        dispatches.push(
          sendBulkDm({ recipients: dmCc, content: ccMsg, botName: BOT_NAME, roomName: ROOM_NAME })
            .then(({ sent, failed }) => log.info({ sent, failed }, "PAT DM CC sent"))
            .catch((e) => log.warn({ e }, "PAT bulk DM CC failed")),
        );
      }
    }

    // 4b. webhook fallback 발송
    for (const [url, { hasTo, hasCC }] of webhookMap) {
      if (hasTo) {
        dispatches.push(
          sendSushantalkToUrl(url, toMsg).catch((e) => log.warn({ e, url }, "dept webhook To failed")),
        );
      } else if (hasCC) {
        dispatches.push(
          sendSushantalkToUrl(url, ccMsg).catch((e) => log.warn({ e, url }, "dept webhook CC failed")),
        );
      }
    }
    await Promise.all(dispatches);

    // ── 5. Main QC/lab channel for key status transitions ─────
    let mainChannelSent = false;
    if (to === "OPEN" || to === "APPROVED" || to === "ERP_SYNCED") {
      const channel = report.productType === "개발" ? "lab" : "qc";
      await sendSushantalkMessage(channel, toMsg).catch((e) =>
        log.warn({ e, channel }, "main channel failed"),
      );
      mainChannelSent = true;
      log.info({ channel, to }, "main channel notified");
    }

    const anySent = mainChannelSent || webhookMap.size > 0 || dmTo.length > 0 || dmCc.length > 0;
    const sentAt = anySent ? new Date() : null;
    return { sentAt, channel: report.productType === "개발" ? "lab" : "qc" };
  } catch (err) {
    log.error({ err }, "notifyStatusTransition failed (non-fatal)");
    return { sentAt: null, channel: null };
  }
}

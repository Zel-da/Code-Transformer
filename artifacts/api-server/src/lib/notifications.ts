import { eq, inArray } from "drizzle-orm";
import { db, usersTable, departmentsTable, nonConformityReportsTable } from "@workspace/db";
import type { NonConformityReport } from "@workspace/db";
import { sendSushantalkToUrl, sendSushantalkMessage } from "./sushantalk.js";
import { logger as rootLogger } from "./logger.js";

type QcStatus = "OPEN" | "IN_REVIEW" | "PENDING_COLLAB" | "RESOLVED" | "APPROVED" | "ERP_SYNCED";
type UserRole = "admin" | "worker" | "reviewer" | "approver" | "collaborator";

const STATUS_LABELS: Record<QcStatus, string> = {
  OPEN: "부적합 접수",
  IN_REVIEW: "QC 검토 시작",
  PENDING_COLLAB: "협업 요청",
  RESOLVED: "조치 완료",
  APPROVED: "승인 완료",
  ERP_SYNCED: "ERP 등록 완료",
};

// Per-status routing: roles that are To recipients vs CC recipients
// "To" users (notifyLevel='to') receive the full message.
// "CC" users (notifyLevel='cc') receive a brief summary.
// Users with notifyLevel='none' are skipped entirely.
const STATUS_ROUTING: Record<QcStatus, { toRoles: UserRole[]; ccRoles: UserRole[] }> = {
  OPEN:           { toRoles: ["reviewer", "approver"], ccRoles: ["admin"] },
  IN_REVIEW:      { toRoles: ["worker", "collaborator"], ccRoles: ["reviewer", "approver"] },
  PENDING_COLLAB: { toRoles: [], ccRoles: [] },
  RESOLVED:       { toRoles: ["approver"], ccRoles: ["reviewer", "admin"] },
  APPROVED:       { toRoles: ["admin"], ccRoles: ["reviewer", "approver"] },
  ERP_SYNCED:     { toRoles: ["reviewer", "approver"], ccRoles: ["worker", "admin"] },
};

function buildToMessage(
  report: NonConformityReport,
  to: QcStatus,
  appUrl: string,
): string {
  const label = STATUS_LABELS[to] ?? to;
  const ncr = report.ncrNumber ?? `#${report.id}`;
  const link = `${appUrl}/admin?reportId=${report.id}`;
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
  const link = `${appUrl}/admin?reportId=${report.id}`;
  const fromLabel = from ? (STATUS_LABELS[from] ?? from) : "신규";
  const toLabel = STATUS_LABELS[to] ?? to;
  return `[참조] ${ncr} 상태 변경: ${fromLabel} → ${toLabel}\n링크: ${link}`;
}

/**
 * Send intelligent notifications for a QC status transition.
 *
 * - To recipients (notifyLevel='to') receive the full detailed message.
 * - CC recipients (notifyLevel='cc') receive a brief summary.
 * - Users with notifyLevel='none' are skipped.
 * - Delivery is via each user's department webhook URL (if configured).
 * - For OPEN and ERP_SYNCED, also sends to the main QC/lab channel.
 *
 * Returns { sentAt } for callers that need to update the DB timestamp.
 */
export async function notifyStatusTransition(opts: {
  report: NonConformityReport;
  from: QcStatus | null;
  to: QcStatus;
  taggedUserIds?: number[];
}): Promise<{ sentAt: Date | null; channel: string | null }> {
  const { report, from, to, taggedUserIds } = opts;
  const appUrl = process.env.APP_URL ?? "https://your-app.replit.app";
  const log = rootLogger.child({ fn: "notifyStatusTransition", reportId: report.id, to });

  try {
    const toMsg = buildToMessage(report, to, appUrl);
    const ccMsg = buildCcMessage(report, from, to, appUrl);

    // ── 1. Determine which users to query ────────────────────────────
    const routing = STATUS_ROUTING[to];
    let toUserIds: number[] | null = null;
    let ccUserIds: number[] | null = null;

    if (to === "PENDING_COLLAB" && taggedUserIds && taggedUserIds.length > 0) {
      // Tagged users are always To recipients
      toUserIds = taggedUserIds;
    } else {
      const allRoles = [...new Set([...routing.toRoles, ...routing.ccRoles])];
      if (allRoles.length === 0) return { sentAt: null, channel: null };

      const activeUsers = await db
        .select({ id: usersTable.id, role: usersTable.role, deptCd: usersTable.deptCd, notifyLevel: usersTable.notifyLevel })
        .from(usersTable)
        .where(eq(usersTable.isActive, true));

      const eligible = activeUsers.filter(
        (u) => allRoles.includes(u.role as UserRole) && u.notifyLevel !== "none",
      );

      const toUsers = eligible.filter(
        (u) => routing.toRoles.includes(u.role as UserRole) && u.notifyLevel === "to",
      );
      const ccUsers = eligible.filter(
        (u) =>
          (routing.ccRoles.includes(u.role as UserRole) ||
            (routing.toRoles.includes(u.role as UserRole) && u.notifyLevel === "cc")) &&
          !toUsers.find((t) => t.id === u.id),
      );

      toUserIds = toUsers.map((u) => u.id);
      ccUserIds = ccUsers.map((u) => u.id);
    }

    // ── 2. Collect dept webhook URLs ─────────────────────────────────
    const deptCache = new Map<string, string | null>();

    async function getDeptWebhook(deptCd: string): Promise<string | null> {
      if (deptCache.has(deptCd)) return deptCache.get(deptCd)!;
      const [dept] = await db
        .select({ webhookUrl: departmentsTable.webhookUrl })
        .from(departmentsTable)
        .where(eq(departmentsTable.deptCd, deptCd));
      const url = dept?.webhookUrl ?? null;
      deptCache.set(deptCd, url);
      return url;
    }

    // Gather user deptCd info for To/CC users
    let allUserIds: number[] = [];
    if (toUserIds) allUserIds = [...allUserIds, ...toUserIds];
    if (ccUserIds) allUserIds = [...allUserIds, ...ccUserIds];

    if (allUserIds.length > 0) {
      const userDepts = await db
        .select({ id: usersTable.id, deptCd: usersTable.deptCd, notifyLevel: usersTable.notifyLevel, role: usersTable.role })
        .from(usersTable)
        .where(inArray(usersTable.id, allUserIds));

      // Build webhook → { hasTo, hasCC } map
      const webhookMap = new Map<string, { hasTo: boolean; hasCC: boolean }>();

      for (const u of userDepts) {
        if (!u.deptCd) continue;
        const webhookUrl = await getDeptWebhook(u.deptCd);
        if (!webhookUrl) continue;

        const isTo = toUserIds?.includes(u.id) ?? false;
        const entry = webhookMap.get(webhookUrl) ?? { hasTo: false, hasCC: false };
        if (isTo) entry.hasTo = true;
        else entry.hasCC = true;
        webhookMap.set(webhookUrl, entry);
      }

      // ── 3. Send to dept webhooks ──────────────────────────────────
      const sends: Promise<void>[] = [];
      for (const [url, { hasTo, hasCC }] of webhookMap) {
        if (hasTo) {
          sends.push(
            sendSushantalkToUrl(url, toMsg).catch((err) =>
              log.warn({ err, url }, "dept webhook send failed (To)"),
            ),
          );
        } else if (hasCC) {
          sends.push(
            sendSushantalkToUrl(url, ccMsg).catch((err) =>
              log.warn({ err, url }, "dept webhook send failed (CC)"),
            ),
          );
        }
      }
      await Promise.all(sends);
    }

    // ── 4. Also send to main QC/lab channel for key transitions ──────
    let mainChannelSent = false;
    if (to === "OPEN" || to === "ERP_SYNCED" || to === "APPROVED") {
      const channel = report.productType === "개발" ? "lab" : "qc";
      await sendSushantalkMessage(channel, toMsg).catch((err) =>
        log.warn({ err, channel }, "main channel send failed"),
      );
      mainChannelSent = true;
      log.info({ channel, to }, "main channel notified");
    }

    // ── 5. Dept webhook for the report's귀책부서 (OPEN / ERP_SYNCED) ─
    if ((to === "OPEN" || to === "ERP_SYNCED") && report.deptCd) {
      const deptWebhookUrl = await getDeptWebhook(report.deptCd);
      if (deptWebhookUrl) {
        const deptText =
          to === "OPEN"
            ? `[귀책 부서 알림] 부적합 보고서가 접수되었습니다.\n품목: ${report.itemCode}\n공정: ${report.processName}${report.actionDirection ? `\n조치 방향: ${report.actionDirection}` : ""}\n링크: ${appUrl}/admin?reportId=${report.id}`
            : `[귀책 부서 알림] 부적합 보고서가 ERP에 등록되었습니다.\n품목: ${report.itemCode}\n${report.ncrNumber ?? ""}\n링크: ${appUrl}/admin?reportId=${report.id}`;
        await sendSushantalkToUrl(deptWebhookUrl, deptText).catch((err) =>
          log.warn({ err, deptCd: report.deptCd }, "dept귀책 webhook failed"),
        );
      }
    }

    const sentAt = mainChannelSent || allUserIds.length > 0 ? new Date() : null;
    return { sentAt, channel: report.productType === "개발" ? "lab" : "qc" };
  } catch (err) {
    log.error({ err }, "notifyStatusTransition failed (non-fatal)");
    return { sentAt: null, channel: null };
  }
}

import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, reportCommentsTable, nonConformityReportsTable, usersTable, departmentsTable } from "@workspace/db";
import { requireAuth } from "../middleware/requireAuth.js";
import { sendSushantalkToUrl } from "../lib/sushantalk.js";
import { z } from "zod";

const router: IRouter = Router();

const CreateCommentBody = z.object({
  body: z.string().min(1).max(4000),
  taggedUserIds: z.array(z.number().int()).optional().default([]),
});

const UpdateCommentBody = z.object({
  body: z.string().min(1).max(4000),
});

function parseId(raw: string | string[]): number {
  const str = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(str, 10);
}

router.get("/reports/:id/comments", requireAuth, async (req, res): Promise<void> => {
  const reportId = parseId(req.params.id);
  if (isNaN(reportId)) {
    res.status(400).json({ error: "Invalid report id" });
    return;
  }

  const [report] = await db
    .select({ id: nonConformityReportsTable.id })
    .from(nonConformityReportsTable)
    .where(eq(nonConformityReportsTable.id, reportId));

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  const comments = await db
    .select()
    .from(reportCommentsTable)
    .where(eq(reportCommentsTable.reportId, reportId))
    .orderBy(reportCommentsTable.createdAt);

  res.json(comments);
});

router.post("/reports/:id/comments", requireAuth, async (req, res): Promise<void> => {
  const reportId = parseId(req.params.id);
  if (isNaN(reportId)) {
    res.status(400).json({ error: "Invalid report id" });
    return;
  }

  const parsed = CreateCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [report] = await db
    .select({ id: nonConformityReportsTable.id, itemCode: nonConformityReportsTable.itemCode })
    .from(nonConformityReportsTable)
    .where(eq(nonConformityReportsTable.id, reportId));

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  const authorId = req.auth!.userId;
  const [authorUser] = await db
    .select({ displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.id, authorId));

  const authorName = authorUser?.displayName ?? req.auth!.username ?? "알 수 없음";

  const [comment] = await db
    .insert(reportCommentsTable)
    .values({
      reportId,
      authorId,
      authorName,
      body: parsed.data.body,
      taggedUserIds: parsed.data.taggedUserIds,
    })
    .returning();

  req.log.info({ reportId, commentId: comment.id, by: authorId }, "Report comment created");
  res.status(201).json(comment);

  // Fire-and-forget: @태그 된 사용자 부서 웹훅으로 알림 발송
  if (parsed.data.taggedUserIds.length > 0) {
    (async () => {
      try {
        const appUrl = process.env.APP_URL ?? "https://your-app.replit.app";
        const mentionedUsers = await db
          .select({ id: usersTable.id, displayName: usersTable.displayName, deptCd: usersTable.deptCd })
          .from(usersTable)
          .where(inArray(usersTable.id, parsed.data.taggedUserIds));

        const deptCds = [...new Set(mentionedUsers.map((u) => u.deptCd).filter(Boolean) as string[])];

        for (const deptCd of deptCds) {
          const [dept] = await db
            .select({ webhookUrl: departmentsTable.webhookUrl })
            .from(departmentsTable)
            .where(eq(departmentsTable.deptCd, deptCd));

          if (dept?.webhookUrl) {
            const names = mentionedUsers
              .filter((u) => u.deptCd === deptCd)
              .map((u) => u.displayName)
              .join(", ");
            const text = `[협업 의견 알림] ${authorName}님이 보고서 #${reportId} (${report.itemCode})에서 ${names}님을 언급하였습니다.\n의견: ${parsed.data.body.slice(0, 200)}\n링크: ${appUrl}/ledger`;
            await sendSushantalkToUrl(dept.webhookUrl, text);
          }
        }
      } catch (err) {
        req.log.error({ err, reportId, commentId: comment.id }, "@tag notification failed (non-fatal)");
      }
    })();
  }
});

router.put("/reports/:id/comments/:cid", requireAuth, async (req, res): Promise<void> => {
  const reportId = parseId(req.params.id);
  const cid = parseId(req.params.cid);
  if (isNaN(reportId) || isNaN(cid)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const parsed = UpdateCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(reportCommentsTable)
    .where(and(eq(reportCommentsTable.id, cid), eq(reportCommentsTable.reportId, reportId)));

  if (!existing) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const actorId = req.auth!.userId;
  const actorRole = req.auth!.role;

  if (existing.authorId !== actorId && actorRole !== "admin") {
    res.status(403).json({ error: "본인 의견만 수정할 수 있습니다." });
    return;
  }

  const [updated] = await db
    .update(reportCommentsTable)
    .set({ body: parsed.data.body, isEdited: true })
    .where(eq(reportCommentsTable.id, cid))
    .returning();

  req.log.info({ commentId: cid, by: actorId }, "Comment updated");
  res.json(updated);
});

router.delete("/reports/:id/comments/:cid", requireAuth, async (req, res): Promise<void> => {
  const reportId = parseId(req.params.id);
  const cid = parseId(req.params.cid);
  if (isNaN(reportId) || isNaN(cid)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [existing] = await db
    .select()
    .from(reportCommentsTable)
    .where(and(eq(reportCommentsTable.id, cid), eq(reportCommentsTable.reportId, reportId)));

  if (!existing) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const actorId = req.auth!.userId;
  const actorRole = req.auth!.role;

  if (existing.authorId !== actorId && actorRole !== "admin") {
    res.status(403).json({ error: "본인 의견만 삭제할 수 있습니다." });
    return;
  }

  await db.delete(reportCommentsTable).where(eq(reportCommentsTable.id, cid));
  req.log.info({ commentId: cid, by: actorId }, "Comment deleted");
  res.status(204).send();
});

export default router;

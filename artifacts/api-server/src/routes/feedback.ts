import { Router, type IRouter } from "express";
import { eq, desc, isNull, and, sql } from "drizzle-orm";
import {
  db,
  feedbackTable,
  feedbackCommentsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/requireAuth.js";
import { sendBulkDm, isPatConfigured } from "../lib/sushantalk.js";
import { logger as rootLogger } from "../lib/logger.js";
import { z } from "zod";

const router: IRouter = Router();
const log = rootLogger.child({ fn: "feedback" });

const BOT_NAME = "부적합 보고 시스템";
const ROOM_NAME = "🔔 NCR 알림";

const STATUS_LABELS: Record<string, string> = {
  OPEN: "대기",
  IN_PROGRESS: "작업중",
  RESOLVED: "완료",
  CLOSED: "종료",
};

const AttachmentSchema = z.object({
  url: z.string(),
  name: z.string(),
  mimeType: z.string().default("application/octet-stream"),
});

const CreateFeedbackBody = z.object({
  title: z.string().min(1, "제목을 입력해주세요").max(200),
  content: z.string().min(1, "내용을 입력해주세요").max(5000),
  attachments: z.array(AttachmentSchema).optional().default([]),
});

const UpdateFeedbackBody = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(5000).optional(),
  attachments: z.array(AttachmentSchema).optional(),
});

const StatusBody = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]),
});

const CreateCommentBody = z.object({
  content: z.string().min(1, "내용을 입력해주세요").max(2000),
});

function parseId(raw: string | string[]): number {
  const str = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(str, 10);
}

async function getAdminRecipients() {
  if (!isPatConfigured()) return [];
  const admins = await db
    .select({ email: usersTable.email, notifyLevel: usersTable.notifyLevel })
    .from(usersTable)
    .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));
  return admins
    .filter((u) => u.email && u.notifyLevel !== "none")
    .map((u) => ({ toEmail: u.email! }));
}

// ── GET /feedback ─────────────────────────────────────────────────
router.get("/feedback", requireAuth, async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.role === "admin";

  const rows = await db
    .select({
      id: feedbackTable.id,
      title: feedbackTable.title,
      authorId: feedbackTable.authorId,
      authorName: usersTable.displayName,
      status: feedbackTable.status,
      attachmentCount:
        sql<number>`jsonb_array_length(coalesce(${feedbackTable.attachments}, '[]'::jsonb))`,
      createdAt: feedbackTable.createdAt,
      updatedAt: feedbackTable.updatedAt,
    })
    .from(feedbackTable)
    .leftJoin(usersTable, eq(feedbackTable.authorId, usersTable.id))
    .where(
      and(
        isNull(feedbackTable.deletedAt),
        status ? eq(feedbackTable.status, status) : undefined,
        isAdmin ? undefined : eq(feedbackTable.authorId, userId),
      ),
    )
    .orderBy(desc(feedbackTable.createdAt));

  // comment counts
  const commentCounts = await db
    .select({
      feedbackId: feedbackCommentsTable.feedbackId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(feedbackCommentsTable)
    .where(isNull(feedbackCommentsTable.deletedAt))
    .groupBy(feedbackCommentsTable.feedbackId);

  const countMap = Object.fromEntries(
    commentCounts.map((r) => [r.feedbackId, r.count]),
  );

  res.json(rows.map((r) => ({ ...r, commentCount: countMap[r.id] ?? 0 })));
});

// ── POST /feedback ────────────────────────────────────────────────
router.post("/feedback", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "입력값 오류" });
    return;
  }

  const { title, content, attachments } = parsed.data;
  const authorId = req.auth!.userId;

  const [item] = await db
    .insert(feedbackTable)
    .values({ title, content, authorId, attachments: attachments as any, status: "OPEN" })
    .returning();

  // 관리자에게 알림
  const recipients = await getAdminRecipients();
  if (recipients.length > 0) {
    const appUrl = process.env.APP_URL ?? "";
    sendBulkDm({
      recipients,
      content: `[새 피드백] ${title}\n작성자: ${req.auth!.username}\n${content.slice(0, 120)}${content.length > 120 ? "..." : ""}\n🔗 ${appUrl}/feedback`,
      botName: BOT_NAME,
      roomName: ROOM_NAME,
    }).catch((e) => log.warn({ e }, "feedback admin notify failed"));
  }

  res.status(201).json(item);
});

// ── GET /feedback/:id ─────────────────────────────────────────────
router.get("/feedback/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "잘못된 ID" }); return; }

  const userId = req.auth!.userId;
  const isAdmin = req.auth!.role === "admin";

  const [item] = await db
    .select({
      id: feedbackTable.id,
      title: feedbackTable.title,
      content: feedbackTable.content,
      authorId: feedbackTable.authorId,
      authorName: usersTable.displayName,
      status: feedbackTable.status,
      attachments: feedbackTable.attachments,
      createdAt: feedbackTable.createdAt,
      updatedAt: feedbackTable.updatedAt,
    })
    .from(feedbackTable)
    .leftJoin(usersTable, eq(feedbackTable.authorId, usersTable.id))
    .where(and(eq(feedbackTable.id, id), isNull(feedbackTable.deletedAt)));

  if (!item) { res.status(404).json({ error: "피드백을 찾을 수 없습니다" }); return; }
  if (!isAdmin && item.authorId !== userId) { res.status(403).json({ error: "권한이 없습니다" }); return; }

  const comments = await db
    .select({
      id: feedbackCommentsTable.id,
      feedbackId: feedbackCommentsTable.feedbackId,
      authorId: feedbackCommentsTable.authorId,
      authorName: usersTable.displayName,
      content: feedbackCommentsTable.content,
      isAdminReply: feedbackCommentsTable.isAdminReply,
      createdAt: feedbackCommentsTable.createdAt,
      updatedAt: feedbackCommentsTable.updatedAt,
    })
    .from(feedbackCommentsTable)
    .leftJoin(usersTable, eq(feedbackCommentsTable.authorId, usersTable.id))
    .where(
      and(
        eq(feedbackCommentsTable.feedbackId, id),
        isNull(feedbackCommentsTable.deletedAt),
      ),
    )
    .orderBy(feedbackCommentsTable.createdAt);

  res.json({ ...item, comments });
});

// ── PUT /feedback/:id ─────────────────────────────────────────────
router.put("/feedback/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "잘못된 ID" }); return; }

  const parsed = UpdateFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "입력값 오류" });
    return;
  }

  const userId = req.auth!.userId;
  const isAdmin = req.auth!.role === "admin";

  const [existing] = await db
    .select({ authorId: feedbackTable.authorId })
    .from(feedbackTable)
    .where(and(eq(feedbackTable.id, id), isNull(feedbackTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "피드백을 찾을 수 없습니다" }); return; }
  if (!isAdmin && existing.authorId !== userId) { res.status(403).json({ error: "권한이 없습니다" }); return; }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.content !== undefined) updates.content = parsed.data.content;
  if (parsed.data.attachments !== undefined) updates.attachments = parsed.data.attachments;

  const [updated] = await db
    .update(feedbackTable)
    .set(updates)
    .where(eq(feedbackTable.id, id))
    .returning();
  res.json(updated);
});

// ── DELETE /feedback/:id ──────────────────────────────────────────
router.delete("/feedback/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "잘못된 ID" }); return; }

  const userId = req.auth!.userId;
  const isAdmin = req.auth!.role === "admin";

  const [existing] = await db
    .select({ authorId: feedbackTable.authorId })
    .from(feedbackTable)
    .where(and(eq(feedbackTable.id, id), isNull(feedbackTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "피드백을 찾을 수 없습니다" }); return; }
  if (!isAdmin && existing.authorId !== userId) { res.status(403).json({ error: "권한이 없습니다" }); return; }

  await db
    .update(feedbackTable)
    .set({ deletedAt: new Date() })
    .where(eq(feedbackTable.id, id));
  res.status(204).end();
});

// ── PATCH /feedback/:id/status (admin only) ───────────────────────
router.patch("/feedback/:id/status", requireAuth, async (req, res): Promise<void> => {
  if (req.auth!.role !== "admin") {
    res.status(403).json({ error: "관리자 권한이 필요합니다" });
    return;
  }
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "잘못된 ID" }); return; }

  const parsed = StatusBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "유효하지 않은 상태값" }); return; }

  const [existing] = await db
    .select({ authorId: feedbackTable.authorId, title: feedbackTable.title })
    .from(feedbackTable)
    .where(and(eq(feedbackTable.id, id), isNull(feedbackTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "피드백을 찾을 수 없습니다" }); return; }

  const [updated] = await db
    .update(feedbackTable)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(feedbackTable.id, id))
    .returning();

  // 작성자에게 알림
  if (isPatConfigured()) {
    const [author] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, existing.authorId));
    if (author?.email) {
      const appUrl = process.env.APP_URL ?? "";
      sendBulkDm({
        recipients: [{ toEmail: author.email }],
        content: `[피드백 상태 변경] "${existing.title}"\n변경된 상태: ${STATUS_LABELS[parsed.data.status] ?? parsed.data.status}\n🔗 ${appUrl}/feedback`,
        botName: BOT_NAME,
        roomName: ROOM_NAME,
      }).catch((e) => log.warn({ e }, "status notify failed"));
    }
  }

  res.json(updated);
});

// ── POST /feedback/:id/comments ───────────────────────────────────
router.post("/feedback/:id/comments", requireAuth, async (req, res): Promise<void> => {
  const feedbackId = parseId(req.params.id);
  if (isNaN(feedbackId)) { res.status(400).json({ error: "잘못된 ID" }); return; }

  const parsed = CreateCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }

  const userId = req.auth!.userId;
  const isAdmin = req.auth!.role === "admin";

  const [feedback] = await db
    .select({ authorId: feedbackTable.authorId, title: feedbackTable.title })
    .from(feedbackTable)
    .where(and(eq(feedbackTable.id, feedbackId), isNull(feedbackTable.deletedAt)));
  if (!feedback) { res.status(404).json({ error: "피드백을 찾을 수 없습니다" }); return; }
  if (!isAdmin && feedback.authorId !== userId) { res.status(403).json({ error: "권한이 없습니다" }); return; }

  await db.insert(feedbackCommentsTable).values({
    feedbackId,
    authorId: userId,
    content: parsed.data.content,
    isAdminReply: isAdmin,
  });

  // 관리자 답변 → 작성자에게 알림
  if (isAdmin && feedback.authorId !== userId && isPatConfigured()) {
    const [author] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, feedback.authorId));
    if (author?.email) {
      const appUrl = process.env.APP_URL ?? "";
      sendBulkDm({
        recipients: [{ toEmail: author.email }],
        content: `[피드백 답변] "${feedback.title}"\n${parsed.data.content.slice(0, 200)}${parsed.data.content.length > 200 ? "..." : ""}\n🔗 ${appUrl}/feedback`,
        botName: BOT_NAME,
        roomName: ROOM_NAME,
      }).catch((e) => log.warn({ e }, "admin reply notify failed"));
    }
  }

  // 일반 댓글 → 관리자에게 알림
  if (!isAdmin && isPatConfigured()) {
    const recipients = await getAdminRecipients();
    if (recipients.length > 0) {
      const appUrl = process.env.APP_URL ?? "";
      sendBulkDm({
        recipients,
        content: `[피드백 댓글] "${feedback.title}"\n${parsed.data.content.slice(0, 200)}${parsed.data.content.length > 200 ? "..." : ""}\n🔗 ${appUrl}/feedback`,
        botName: BOT_NAME,
        roomName: ROOM_NAME,
      }).catch((e) => log.warn({ e }, "comment admin notify failed"));
    }
  }

  // 반환: 작성자 이름 포함
  const [withAuthor] = await db
    .select({
      id: feedbackCommentsTable.id,
      feedbackId: feedbackCommentsTable.feedbackId,
      authorId: feedbackCommentsTable.authorId,
      authorName: usersTable.displayName,
      content: feedbackCommentsTable.content,
      isAdminReply: feedbackCommentsTable.isAdminReply,
      createdAt: feedbackCommentsTable.createdAt,
      updatedAt: feedbackCommentsTable.updatedAt,
    })
    .from(feedbackCommentsTable)
    .leftJoin(usersTable, eq(feedbackCommentsTable.authorId, usersTable.id))
    .orderBy(desc(feedbackCommentsTable.createdAt))
    .limit(1)
    .where(eq(feedbackCommentsTable.feedbackId, feedbackId));

  res.status(201).json(withAuthor);
});

// ── PUT /feedback/:id/comments/:cid ──────────────────────────────
router.put("/feedback/:id/comments/:cid", requireAuth, async (req, res): Promise<void> => {
  const cid = parseId(req.params.cid);
  if (isNaN(cid)) { res.status(400).json({ error: "잘못된 ID" }); return; }

  const parsed = CreateCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }

  const userId = req.auth!.userId;
  const isAdmin = req.auth!.role === "admin";

  const [comment] = await db
    .select({ authorId: feedbackCommentsTable.authorId })
    .from(feedbackCommentsTable)
    .where(and(eq(feedbackCommentsTable.id, cid), isNull(feedbackCommentsTable.deletedAt)));
  if (!comment) { res.status(404).json({ error: "댓글을 찾을 수 없습니다" }); return; }
  if (!isAdmin && comment.authorId !== userId) { res.status(403).json({ error: "권한이 없습니다" }); return; }

  const [updated] = await db
    .update(feedbackCommentsTable)
    .set({ content: parsed.data.content, updatedAt: new Date() })
    .where(eq(feedbackCommentsTable.id, cid))
    .returning();
  res.json(updated);
});

// ── DELETE /feedback/:id/comments/:cid ───────────────────────────
router.delete("/feedback/:id/comments/:cid", requireAuth, async (req, res): Promise<void> => {
  const cid = parseId(req.params.cid);
  if (isNaN(cid)) { res.status(400).json({ error: "잘못된 ID" }); return; }

  const userId = req.auth!.userId;
  const isAdmin = req.auth!.role === "admin";

  const [comment] = await db
    .select({ authorId: feedbackCommentsTable.authorId })
    .from(feedbackCommentsTable)
    .where(and(eq(feedbackCommentsTable.id, cid), isNull(feedbackCommentsTable.deletedAt)));
  if (!comment) { res.status(404).json({ error: "댓글을 찾을 수 없습니다" }); return; }
  if (!isAdmin && comment.authorId !== userId) { res.status(403).json({ error: "권한이 없습니다" }); return; }

  await db
    .update(feedbackCommentsTable)
    .set({ deletedAt: new Date() })
    .where(eq(feedbackCommentsTable.id, cid));
  res.status(204).end();
});

export default router;

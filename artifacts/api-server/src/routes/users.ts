import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq, desc } from "drizzle-orm";
import { db, usersTable, auditLogsTable } from "@workspace/db";
import { requireAdmin, requireAuth } from "../middleware/requireAuth.js";
import { logger } from "../lib/logger.js";
import { writeAuditLog } from "../lib/audit.js";
import { z } from "zod";

const router: IRouter = Router();

const ROLES = ["admin", "worker", "reviewer", "approver", "collaborator"] as const;
const NOTIFY_LEVELS = ["to", "cc", "none"] as const;

const CreateUserBody = z.object({
  username: z.string().min(2, "아이디는 2자 이상"),
  password: z.string().min(4, "비밀번호는 4자 이상"),
  displayName: z.string().min(1, "이름을 입력해주세요"),
  email: z.string().email("올바른 이메일 형식").optional(),
  role: z.enum(ROLES).default("worker"),
  deptCd: z.string().optional(),
  factory: z.string().optional(),
  plantCd: z.string().optional(),
  processName: z.string().optional(),
  processCd: z.string().optional(),
  notifyLevel: z.enum(NOTIFY_LEVELS).default("to"),
});

const UpdateUserBody = z.object({
  displayName: z.string().min(1).optional(),
  email: z.string().email("올바른 이메일 형식").nullable().optional(),
  password: z.string().min(4).optional(),
  role: z.enum(ROLES).optional(),
  deptCd: z.string().nullable().optional(),
  factory: z.string().nullable().optional(),
  plantCd: z.string().nullable().optional(),
  processName: z.string().nullable().optional(),
  processCd: z.string().nullable().optional(),
  notifyLevel: z.enum(NOTIFY_LEVELS).optional(),
});

const ResetPasswordBody = z.object({
  password: z.string().min(4, "비밀번호는 4자 이상"),
});


router.get("/users", requireAdmin, async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.createdAt);
  res.json(users.map(({ passwordHash: _ph, ...u }) => u));
});

router.post("/users", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "입력값 오류" });
    return;
  }

  const { password, ...rest } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const [user] = await db
      .insert(usersTable)
      .values({ ...rest, passwordHash })
      .returning();

    const { passwordHash: _ph, ...profile } = user;

    await writeAuditLog({
      actorId: req.auth!.userId,
      actorName: req.auth!.username,
      action: "create_user",
      targetType: "user",
      targetId: user.id,
      detail: `계정 생성: ${user.displayName} (@${user.username}), 권한: ${user.role}`,
    });

    res.status(201).json(profile);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("unique")) {
      res.status(409).json({ error: "이미 사용 중인 아이디입니다" });
    } else {
      res.status(500).json({ error: "사용자 생성 실패" });
    }
  }
});

router.put("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "잘못된 ID" }); return; }

  if (req.auth!.role !== "admin" && req.auth!.userId !== id) {
    res.status(403).json({ error: "권한이 없습니다" });
    return;
  }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "입력값 오류" });
    return;
  }

  const { password, ...rest } = parsed.data;
  const updates: Record<string, unknown> = { ...rest };
  if (password) updates.passwordHash = await bcrypt.hash(password, 10);

  if (req.auth!.role !== "admin") {
    delete updates.role;
  }

  const [user] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning();

  if (!user) { res.status(404).json({ error: "사용자를 찾을 수 없습니다" }); return; }

  // Build changed-fields summary from the actual persisted updates (post-auth strip),
  // not from the raw request body, so role is never logged for non-admins.
  const changedFields: string[] = [];
  if (updates.displayName) changedFields.push(`이름: ${updates.displayName}`);
  if (updates.role) changedFields.push(`권한: ${updates.role}`);
  if ("factory" in updates) changedFields.push(`공장: ${updates.factory ?? "없음"}`);
  if ("deptCd" in updates) changedFields.push(`부서: ${updates.deptCd ?? "없음"}`);
  if ("processName" in updates) changedFields.push(`공정: ${updates.processName ?? "없음"}`);
  if (updates.passwordHash) changedFields.push("비밀번호 변경");

  await writeAuditLog({
    actorId: req.auth!.userId,
    actorName: req.auth!.username,
    action: "update_user",
    targetType: "user",
    targetId: id,
    detail: `계정 수정: @${user.username} — ${changedFields.join(", ") || "변경 없음"}`,
  });

  const { passwordHash: _ph, ...profile } = user;
  res.json(profile);
});

router.post("/users/:id/reset-password", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "잘못된 ID" }); return; }

  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "입력값 오류" });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const [user] = await db
    .update(usersTable)
    .set({ passwordHash })
    .where(eq(usersTable.id, id))
    .returning();

  if (!user) { res.status(404).json({ error: "사용자를 찾을 수 없습니다" }); return; }

  await writeAuditLog({
    actorId: req.auth!.userId,
    actorName: req.auth!.username,
    action: "reset_password",
    targetType: "user",
    targetId: id,
    detail: `비밀번호 초기화: @${user.username} (${user.displayName})`,
  });

  res.json({ ok: true });
});

router.patch("/users/:id/active", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "잘못된 ID" }); return; }

  if (req.auth!.userId === id) {
    res.status(400).json({ error: "본인 계정은 비활성화할 수 없습니다" });
    return;
  }

  const isActive = req.body?.isActive;
  if (typeof isActive !== "boolean") {
    res.status(400).json({ error: "isActive(boolean) 필드가 필요합니다" });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set({ isActive })
    .where(eq(usersTable.id, id))
    .returning();

  if (!user) { res.status(404).json({ error: "사용자를 찾을 수 없습니다" }); return; }

  await writeAuditLog({
    actorId: req.auth!.userId,
    actorName: req.auth!.username,
    action: isActive ? "activate_user" : "deactivate_user",
    targetType: "user",
    targetId: id,
    detail: `계정 ${isActive ? "활성화" : "비활성화"}: @${user.username} (${user.displayName})`,
  });

  const { passwordHash: _ph, ...profile } = user;
  res.json(profile);
});

router.delete("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "잘못된 ID" }); return; }

  if (req.auth!.userId === id) {
    res.status(400).json({ error: "본인 계정은 삭제할 수 없습니다" });
    return;
  }

  const [deleted] = await db
    .delete(usersTable)
    .where(eq(usersTable.id, id))
    .returning();

  if (!deleted) { res.status(404).json({ error: "사용자를 찾을 수 없습니다" }); return; }

  await writeAuditLog({
    actorId: req.auth!.userId,
    actorName: req.auth!.username,
    action: "delete_user",
    targetType: "user",
    targetId: id,
    detail: `계정 삭제: @${deleted.username} (${deleted.displayName})`,
  });

  res.status(204).send();
});

router.get("/audit-logs", requireAdmin, async (req, res): Promise<void> => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
  const logs = await db
    .select()
    .from(auditLogsTable)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(limit);
  res.json(logs);
});

export default router;

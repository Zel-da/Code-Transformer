import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq, desc } from "drizzle-orm";
import { db, usersTable, auditLogsTable, departmentsTable } from "@workspace/db";
import { requireAdmin, requireAuth } from "../middleware/requireAuth.js";
import { logger } from "../lib/logger.js";
import { writeAuditLog } from "../lib/audit.js";
import { z } from "zod";
import crypto from "node:crypto";

const router: IRouter = Router();

const ROLES = ["admin", "worker", "reviewer", "approver", "collaborator"] as const;
const NOTIFY_LEVELS = ["to", "cc", "none"] as const;

const CreateUserBody = z.object({
  username: z.string().min(2, "아이디는 2자 이상"),
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
  role: z.enum(ROLES).optional(),
  deptCd: z.string().nullable().optional(),
  factory: z.string().nullable().optional(),
  plantCd: z.string().nullable().optional(),
  processName: z.string().nullable().optional(),
  processCd: z.string().nullable().optional(),
  notifyLevel: z.enum(NOTIFY_LEVELS).optional(),
});

const BulkImportUsersBody = z.object({
  contacts: z.array(z.object({
    displayName: z.string().trim().min(1),
    email: z.string().trim().email().transform((value) => value.toLowerCase()),
    username: z.string().trim().min(2),
    department: z.string().trim(),
    title: z.string().trim(),
    position: z.string().trim(),
  })).min(1).max(500),
});

const NON_PERSON_NAMES = new Set([
  "아워홈", "RPA Robot", "Zoom 인증 계정01", "Zoom 인증 계정02", "jhtest",
  "부품구매", "고객지원", "마케팅", "세보틱스", "수산스캔", "시스템관리자",
  "테스트01", "화성_영양사", "test1",
]);

const DEPARTMENT_ALIASES: Record<string, string> = {
  "BR자재부품팀": "A4CSH11210400",
  "고객지원팀": "A4CSH23101000",
  "국내영업팀": "A4CSH21101000",
  "대표이사": "A4CSH11000000",
  "라인구성 TFT": "A4CSH22102000",
  "부품팀": "A4CSH23103000",
  "생산부문": "A4CSH11231000",
  "생산팀-관리": "A4CSH22101000",
  "수산비나모터": "A4CSH16000000",
  "수산세보틱스": "A4CSH00000000",
  "수산세보틱스 유지보수": "A4CSH00000000",
  "신사업추진팀": "A4CSH24108000",
  "입고품질팀": "A4CSH11231200",
  "자재팀": "A4CSH22103000",
  "천공기개발팀": "A4CSH24101000",
  "특장사업본부": "A4CSH21100000",
};

function toPublicUser(user: typeof usersTable.$inferSelect) {
  const { passwordHash: _ph, tempPasswordHash: _tph, tempPasswordVersion: _tpv, ...rest } = user;
  return { ...rest, hasTempPassword: !!user.tempPasswordHash };
}

router.get("/users", requireAdmin, async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.createdAt);
  res.json(users.map(toPublicUser));
});

router.post("/users", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "입력값 오류" });
    return;
  }

  // 그룹웨어 인증 전용이므로 passwordHash는 sentinel 값 사용
  const sentinelHash = await bcrypt.hash(crypto.randomUUID(), 10);

  try {
    const [user] = await db
      .insert(usersTable)
      .values({ ...parsed.data, passwordHash: sentinelHash })
      .returning();

    await writeAuditLog({
      actorId: req.auth!.userId,
      actorName: req.auth!.username,
      action: "create_user",
      targetType: "user",
      targetId: user.id,
      detail: `계정 생성: ${user.displayName} (@${user.username}), 권한: ${user.role}`,
    });

    res.status(201).json(toPublicUser(user));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("unique")) {
      res.status(409).json({ error: "이미 사용 중인 아이디입니다" });
    } else {
      res.status(500).json({ error: "사용자 생성 실패" });
    }
  }
});

router.post("/users/bulk-import", requireAdmin, async (req, res): Promise<void> => {
  const parsed = BulkImportUsersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "주소록 입력값 오류" });
    return;
  }

  const eligible = parsed.data.contacts.filter((contact) =>
    !contact.department.includes("IT혁신팀")
    && !contact.title.includes("촉탁")
    && !contact.position.includes("촉탁")
    && !NON_PERSON_NAMES.has(contact.displayName)
  );
  const uniqueContacts = Array.from(
    new Map(eligible.map((contact) => [contact.email, contact])).values(),
  );

  const [existingUsers, departments] = await Promise.all([
    db.select({ username: usersTable.username, email: usersTable.email }).from(usersTable),
    db.select({ deptCd: departmentsTable.deptCd, deptName: departmentsTable.deptName }).from(departmentsTable),
  ]);
  const existingUsernames = new Set(existingUsers.map((user) => user.username));
  const existingEmails = new Set(existingUsers.map((user) => user.email?.toLowerCase()).filter(Boolean));
  const departmentByName = new Map(departments.map((department) => [department.deptName, department.deptCd]));
  const missing = uniqueContacts.filter((contact) =>
    !existingUsernames.has(contact.username) && !existingEmails.has(contact.email)
  );

  if (missing.length === 0) {
    res.json({ created: 0, skipped: uniqueContacts.length, excluded: parsed.data.contacts.length - eligible.length });
    return;
  }

  const sentinelHash = await bcrypt.hash(crypto.randomUUID(), 10);
  try {
    const created = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(usersTable)
        .values(missing.map((contact) => ({
          username: contact.username,
          passwordHash: sentinelHash,
          displayName: contact.displayName,
          email: contact.email,
          role: "worker" as const,
          isActive: true,
          deptCd: departmentByName.get(contact.department) ?? DEPARTMENT_ALIASES[contact.department] ?? null,
          notifyLevel: "to" as const,
        })))
        .onConflictDoNothing({ target: usersTable.username })
        .returning();

      if (inserted.length > 0) {
        await tx.insert(auditLogsTable).values(inserted.map((user) => ({
          actorId: req.auth!.userId,
          actorName: req.auth!.username,
          action: "create_user",
          targetType: "user",
          targetId: user.id,
          detail: `주소록 일괄 등록: ${user.displayName} (@${user.username}), 권한: worker`,
        })));
      }
      return inserted;
    });

    req.log.info({ created: created.length, skipped: uniqueContacts.length - created.length }, "Bulk user import completed");
    res.status(201).json({
      created: created.length,
      skipped: uniqueContacts.length - created.length,
      excluded: parsed.data.contacts.length - eligible.length,
    });
  } catch (err) {
    req.log.error({ err }, "Bulk user import failed");
    res.status(500).json({ error: "주소록 일괄 등록에 실패했습니다" });
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

  const updates: Record<string, unknown> = { ...parsed.data };

  if (req.auth!.role !== "admin") {
    delete updates.role;
  }

  const [user] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning();

  if (!user) { res.status(404).json({ error: "사용자를 찾을 수 없습니다" }); return; }

  const changedFields: string[] = [];
  if (updates.displayName) changedFields.push(`이름: ${updates.displayName}`);
  if (updates.role) changedFields.push(`권한: ${updates.role}`);
  if ("factory" in updates) changedFields.push(`공장: ${updates.factory ?? "없음"}`);
  if ("deptCd" in updates) changedFields.push(`부서: ${updates.deptCd ?? "없음"}`);
  if ("processName" in updates) changedFields.push(`공정: ${updates.processName ?? "없음"}`);

  await writeAuditLog({
    actorId: req.auth!.userId,
    actorName: req.auth!.username,
    action: "update_user",
    targetType: "user",
    targetId: id,
    detail: `계정 수정: @${user.username} — ${changedFields.join(", ") || "변경 없음"}`,
  });

  res.json(toPublicUser(user));
});

// 임시 비밀번호 발급 (관리자 전용)
router.post("/users/:id/temp-password", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "잘못된 ID" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) { res.status(404).json({ error: "사용자를 찾을 수 없습니다" }); return; }

  // 8자리 임시 비밀번호 생성 (숫자+영문 대소문자)
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const tempPassword = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const tempPasswordHash = await bcrypt.hash(tempPassword, 10);

  await db.update(usersTable)
    .set({
      tempPasswordHash,
      tempPasswordVersion: user.tempPasswordVersion + 1,
    })
    .where(eq(usersTable.id, id));

  await writeAuditLog({
    actorId: req.auth!.userId,
    actorName: req.auth!.username,
    action: "issue_temp_password",
    targetType: "user",
    targetId: id,
    detail: `임시 비밀번호 발급: @${user.username} (${user.displayName})`,
  });

  // 발급된 평문 비밀번호를 이 응답에서만 반환 (이후 조회 불가)
  res.json({ tempPassword });
});

// 임시 비밀번호 해제 (관리자 전용)
router.delete("/users/:id/temp-password", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "잘못된 ID" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) { res.status(404).json({ error: "사용자를 찾을 수 없습니다" }); return; }

  await db.update(usersTable)
    .set({
      tempPasswordHash: null,
      tempPasswordVersion: user.tempPasswordVersion + 1,
    })
    .where(eq(usersTable.id, id));

  await writeAuditLog({
    actorId: req.auth!.userId,
    actorName: req.auth!.username,
    action: "revoke_temp_password",
    targetType: "user",
    targetId: id,
    detail: `임시 비밀번호 해제: @${user.username} (${user.displayName})`,
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

  res.json(toPublicUser(user));
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

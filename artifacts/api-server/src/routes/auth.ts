import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { requireAuth, requireTemporaryPasswordSetup, signToken } from "../middleware/requireAuth.js";
import { z } from "zod";
import nodemailer from "nodemailer";
import { writeAuditLog } from "../lib/audit.js";

const router: IRouter = Router();

const EmailLoginBody = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

const CompleteTemporaryLoginBody = z.object({
  password: z.string().min(1, "그룹웨어 비밀번호를 입력해주세요"),
});

async function verifySmtpCredentials(email: string, password: string): Promise<boolean> {
  const host = process.env.SMTP_HOST ?? "spam.soosan.co.kr";
  const port = parseInt(process.env.SMTP_PORT ?? "465", 10);

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: true,
    auth: { user: email, pass: password },
    tls: { minVersion: "TLSv1.2" },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });

  try {
    await transport.verify();
    return true;
  } catch {
    return false;
  } finally {
    transport.close();
  }
}

function toPublicUser(user: typeof usersTable.$inferSelect) {
  const { passwordHash: _ph, tempPasswordHash: _tph, tempPasswordVersion: _tpv, ...rest } = user;
  return { ...rest, hasTempPassword: !!user.tempPasswordHash };
}

router.post("/auth/email-login", async (req, res): Promise<void> => {
  const parsed = EmailLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "이메일과 비밀번호를 입력해주세요" });
    return;
  }

  const { email: identifier, password } = parsed.data;
  const isEmailLogin = identifier.includes("@");

  const [user] = await db
    .select()
    .from(usersTable)
    .where(isEmailLogin
      ? eq(usersTable.email, identifier)
      : eq(usersTable.username, identifier));

  if (!user) {
    res.status(401).json({ error: "등록된 계정을 찾을 수 없습니다. 관리자에게 문의하세요." });
    return;
  }

  if (!user.isActive) {
    res.status(401).json({ error: "비활성화된 계정입니다. 관리자에게 문의하세요." });
    return;
  }

  // 1차: 그룹웨어(SMTP) 인증
  const smtpOk = isEmailLogin && user.email
    ? await verifySmtpCredentials(user.email, password)
    : false;

  if (smtpOk) {
    // 그룹웨어 인증이 복구되면 임시 비밀번호는 더 이상 필요하지 않다.
    if (user.tempPasswordHash) {
      await db.update(usersTable)
        .set({
          tempPasswordHash: null,
          tempPasswordVersion: user.tempPasswordVersion + 1,
        })
        .where(eq(usersTable.id, user.id));
    }
    const token = signToken({ userId: user.id, username: user.username, role: user.role, authMethod: "groupware" });
    res.json({
      token,
      user: toPublicUser({ ...user, tempPasswordHash: null }),
      authentication: "groupware",
      requiresPasswordSetup: false,
    });
    return;
  }

  // 2차: SMTP 실패 시에만 임시 비밀번호를 확인한다.
  if (user.tempPasswordHash) {
    const tempOk = await bcrypt.compare(password, user.tempPasswordHash);
    if (tempOk) {
      const token = signToken({
        userId: user.id,
        username: user.username,
        role: user.role,
        authMethod: "temporary",
        temporaryPasswordVersion: user.tempPasswordVersion,
      }, "10m");
      res.json({
        token,
        user: toPublicUser(user),
        authentication: "temporary",
        requiresPasswordSetup: true,
      });
      return;
    }
  }

  // 3차: SMTP 실패 시에만 등록된 내부 폴백 비밀번호를 확인한다.
  const fallbackOk = await bcrypt.compare(password, user.passwordHash);
  if (fallbackOk) {
    const token = signToken({ userId: user.id, username: user.username, role: user.role, authMethod: "internal" });
    res.json({
      token,
      user: toPublicUser(user),
      authentication: "internal",
      requiresPasswordSetup: false,
    });
    return;
  }

  res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다" });
});

router.post("/auth/complete-temp-login", requireTemporaryPasswordSetup, async (req, res): Promise<void> => {
  const parsed = CompleteTemporaryLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "입력값 오류" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.auth!.userId));

  if (!user) {
    res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
    return;
  }

  if (!user.tempPasswordHash) {
    res.status(409).json({ error: "임시 비밀번호가 이미 해제되었습니다. 다시 로그인해주세요." });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const [updatedUser] = await db
    .update(usersTable)
    .set({
      passwordHash,
      tempPasswordHash: null,
      tempPasswordVersion: user.tempPasswordVersion + 1,
    })
    .where(eq(usersTable.id, user.id))
    .returning();

  await writeAuditLog({
    actorId: user.id,
    actorName: user.username,
    action: "complete_temp_password_setup",
    targetType: "user",
    targetId: user.id,
    detail: `임시 비밀번호 전환 완료: @${user.username}`,
  });

  const token = signToken({
    userId: updatedUser.id,
    username: updatedUser.username,
    role: updatedUser.role,
    authMethod: "internal",
  });

  res.json({
    token,
    user: toPublicUser(updatedUser),
    authentication: "internal",
    requiresPasswordSetup: false,
  });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.auth!.userId));

  if (!user) {
    res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
    return;
  }

  res.json(toPublicUser(user));
});

router.post("/auth/logout", (_req, res): void => {
  res.json({ ok: true });
});

export default router;

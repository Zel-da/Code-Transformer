import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { requireAuth, signToken } from "../middleware/requireAuth.js";
import { z } from "zod";
import nodemailer from "nodemailer";

const router: IRouter = Router();

const EmailLoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function verifySmtpCredentials(email: string, password: string): Promise<boolean> {
  const host = process.env.SMTP_HOST ?? "spam.soosan.co.kr";
  const port = parseInt(process.env.SMTP_PORT ?? "465", 10);

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: true,
    auth: { user: email, pass: password },
    tls: { rejectUnauthorized: false },
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
  const { passwordHash: _ph, tempPasswordHash: _tph, ...rest } = user;
  return { ...rest, hasTempPassword: !!user.tempPasswordHash };
}

router.post("/auth/email-login", async (req, res): Promise<void> => {
  const parsed = EmailLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "이메일과 비밀번호를 입력해주세요" });
    return;
  }

  const { email, password } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));

  if (!user) {
    res.status(401).json({ error: "해당 이메일로 등록된 계정이 없습니다. 관리자에게 문의하세요." });
    return;
  }

  if (!user.isActive) {
    res.status(401).json({ error: "비활성화된 계정입니다. 관리자에게 문의하세요." });
    return;
  }

  // 1차: 그룹웨어(SMTP) 인증
  const smtpOk = await verifySmtpCredentials(email, password);

  if (smtpOk) {
    // SMTP 성공 시 임시비번이 있으면 자동 삭제
    if (user.tempPasswordHash) {
      await db.update(usersTable)
        .set({ tempPasswordHash: null })
        .where(eq(usersTable.id, user.id));
    }
    const token = signToken({ userId: user.id, username: user.username, role: user.role });
    res.json({ token, user: toPublicUser(user), usedTempPassword: false });
    return;
  }

  // 2차: 임시 비밀번호 인증 (SMTP 실패 시 폴백)
  if (user.tempPasswordHash) {
    const tempOk = await bcrypt.compare(password, user.tempPasswordHash);
    if (tempOk) {
      const token = signToken({ userId: user.id, username: user.username, role: user.role });
      res.json({ token, user: toPublicUser(user), usedTempPassword: true });
      return;
    }
  }

  res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다" });
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

import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { requireAuth, signToken } from "../middleware/requireAuth.js";
import { z } from "zod";

const router: IRouter = Router();

const LoginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "아이디와 비밀번호를 입력해주세요" });
    return;
  }

  const { username, password } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username));

  if (!user) {
    res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다" });
    return;
  }

  if (!user.isActive) {
    res.status(401).json({ error: "비활성화된 계정입니다. 관리자에게 문의하세요." });
    return;
  }

  const token = signToken({ userId: user.id, username: user.username, role: user.role });

  const { passwordHash: _ph, ...profile } = user;

  res.json({ token, user: profile });
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

  const { passwordHash: _ph, ...profile } = user;
  res.json(profile);
});

router.post("/auth/logout", (_req, res): void => {
  res.json({ ok: true });
});

export default router;

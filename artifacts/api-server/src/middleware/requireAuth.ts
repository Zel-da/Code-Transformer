import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

const JWT_SECRET = process.env.JWT_SECRET || "ncr-dev-secret-2026";

export type UserRole = "admin" | "worker" | "reviewer" | "approver" | "collaborator";

export interface AuthPayload {
  userId: number;
  username: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "인증이 필요합니다" });
    return;
  }
  const token = header.slice(7);

  let payload: AuthPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    res.status(401).json({ error: "유효하지 않은 토큰입니다" });
    return;
  }

  db.select({ isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, payload.userId))
    .then(([user]) => {
      if (!user) {
        res.status(401).json({ error: "사용자를 찾을 수 없습니다" });
        return;
      }
      if (!user.isActive) {
        res.status(401).json({ error: "비활성화된 계정입니다. 관리자에게 문의하세요." });
        return;
      }
      req.auth = payload;
      next();
    })
    .catch(() => {
      res.status(500).json({ error: "인증 처리 중 오류가 발생했습니다" });
    });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.auth?.role !== "admin") {
      res.status(403).json({ error: "관리자 권한이 필요합니다" });
      return;
    }
    next();
  });
}

export function requireRole(roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    requireAuth(req, res, () => {
      if (!roles.includes(req.auth!.role as UserRole)) {
        res.status(403).json({ error: "이 작업을 수행할 권한이 없습니다" });
        return;
      }
      next();
    });
  };
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

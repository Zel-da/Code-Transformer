import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "ncr-dev-secret-2026";

export interface AuthPayload {
  userId: number;
  username: string;
  role: "admin" | "worker";
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
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: "유효하지 않은 토큰입니다" });
  }
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

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

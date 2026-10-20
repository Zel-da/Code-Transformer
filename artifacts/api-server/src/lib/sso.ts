import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, pool, ssoIdentitiesTable, ssoSessionsTable, usersTable } from "@workspace/db";
import { z } from "zod";

export const SESSION_COOKIE = "ncr_sso_session";
export const STATE_COOKIE = "ncr_sso_state";
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomId = () => randomBytes(32).toString("hex");
export const safeNext = (value: unknown) =>
  typeof value === "string" && /^\/(?:ledger|submit|manage|guide|feedback|qc(?:\/\d+)?|report)$/.test(value)
    ? value : "/ledger";

export class SsoError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export function getSsoConfig() {
  const clientId = process.env.SSO_CLIENT_ID;
  const clientSecret = process.env.SSO_CLIENT_SECRET;
  const appBase = process.env.APP_BASE_URL;
  if (!clientId || !clientSecret || !appBase || !process.env.SESSION_SECRET) return null;
  const base = new URL(process.env.SSO_BASE_URL ?? "https://SSC-DashboardHub.replit.app");
  const app = new URL(appBase);
  if (base.protocol !== "https:" || base.pathname !== "/" || base.search || base.hash || base.username || base.password ||
      app.pathname !== "/" || app.search || app.hash || app.username || app.password ||
      (app.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && app.protocol === "http:" && app.hostname === "localhost"))) {
    throw new SsoError(503, "sso_configuration_invalid");
  }
  return { base: base.origin, clientId, clientSecret, app: app.origin,
    callback: `${app.origin}/api/auth/sso/callback`, secure: app.protocol === "https:" };
}

export function cookie(req: Request, name: string): string | null {
  const entry = req.headers.cookie?.split(";").map(s => s.trim()).find(s => s.startsWith(`${name}=`));
  return entry?.slice(name.length + 1) ?? null;
}
export function setSsoCookie(res: Response, name: string, value: string, maxAge: number) {
  res.cookie(name, value, { httpOnly: true, secure: getSsoConfig()?.secure ?? true,
    sameSite: "lax", path: "/api", maxAge });
}
export function clearSsoCookie(res: Response, name: string) {
  res.clearCookie(name, { httpOnly: true, secure: getSsoConfig()?.secure ?? true, sameSite: "lax", path: "/api" });
}

export function sameHash(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function encryptionKey() {
  if (!process.env.SESSION_SECRET) throw new SsoError(503, "sso_configuration_invalid");
  return createHash("sha256").update(`ncr-sso:${process.env.SESSION_SECRET}`).digest();
}
export function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(b => b.toString("base64url")).join(".");
}
function decryptToken(value: string) {
  const [iv, tag, data] = value.split(".").map(s => Buffer.from(s, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

const identitySchema = z.object({
  sub: z.string().regex(/^\d+$/).max(128),
  email: z.string().email().max(320),
  is_active: z.literal(true),
});
const tokenSchema = z.object({
  access_token: z.string().min(1).max(16384),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive().max(3600),
  user: z.object({ sub: z.string(), aud: z.string() }),
});

async function providerJson(path: string, init: RequestInit) {
  const config = getSsoConfig();
  if (!config) throw new SsoError(503, "sso_not_configured");
  let response: globalThis.Response;
  try {
    response = await fetch(`${config.base}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(10000) });
  } catch {
    throw new SsoError(503, "sso_unavailable");
  }
  if (!response.ok) throw new SsoError(response.status === 401 ? 401 : 502, "sso_provider_rejected");
  try { return await response.json(); }
  catch { throw new SsoError(502, "sso_invalid_response"); }
}

export async function userInfo(accessToken: string) {
  const parsed = identitySchema.safeParse(await providerJson("/api/sso/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  }));
  if (!parsed.success) throw new SsoError(401, "sso_invalid_identity");
  return parsed.data;
}
export async function exchangeCode(code: string) {
  const config = getSsoConfig();
  if (!config) throw new SsoError(503, "sso_not_configured");
  // Never retry: the provider may already have consumed this single-use code.
  const parsed = tokenSchema.safeParse(await providerJson("/api/sso/token", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.callback }),
  }));
  if (!parsed.success || parsed.data.user.aud !== config.clientId) throw new SsoError(401, "sso_invalid_audience");
  const token = parsed.data;
  const identity = await userInfo(token.access_token);
  if (identity.sub !== token.user.sub) throw new SsoError(401, "sso_identity_mismatch");
  return { token, identity };
}

export async function mapIdentity(identity: z.infer<typeof identitySchema>) {
  const config = getSsoConfig()!;
  return db.transaction(async tx => {
    // Serialize first-use bindings across all instances.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(57810342)`);
    const [linked] = await tx.select().from(ssoIdentitiesTable)
      .where(and(eq(ssoIdentitiesTable.provider, config.base), eq(ssoIdentitiesTable.subject, identity.sub)));
    if (linked) return linked.userId;
    const matches = await tx.select({ id: usersTable.id, isActive: usersTable.isActive }).from(usersTable)
      .where(sql`lower(trim(${usersTable.email})) = ${identity.email.trim().toLowerCase()}`);
    if (matches.length !== 1 || !matches[0].isActive) throw new SsoError(403, "sso_access_denied");
    const [other] = await tx.select().from(ssoIdentitiesTable)
      .where(and(eq(ssoIdentitiesTable.provider, config.base), eq(ssoIdentitiesTable.userId, matches[0].id)));
    if (other) throw new SsoError(403, "sso_identity_already_linked");
    await tx.insert(ssoIdentitiesTable).values({ provider: config.base, subject: identity.sub, userId: matches[0].id });
    return matches[0].id;
  });
}

export async function authenticateSso(req: Request, res: Response) {
  const id = cookie(req, SESSION_COOKIE);
  const config = getSsoConfig();
  if (!id || !config) throw new SsoError(401, "login_required");
  const [session] = await db.select().from(ssoSessionsTable)
    .where(and(eq(ssoSessionsTable.idHash, digest(id)), eq(ssoSessionsTable.kind, "auth"),
      eq(ssoSessionsTable.provider, config.base), gt(ssoSessionsTable.expiresAt, new Date())));
  if (!session?.encryptedToken || !session.userId) {
    clearSsoCookie(res, SESSION_COOKIE);
    throw new SsoError(401, "login_required");
  }
  // Cookie-authenticated mutations require an exact same-origin Origin.
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("origin") !== config.app) {
    throw new SsoError(403, "invalid_origin");
  }
  try {
    const identity = await userInfo(decryptToken(session.encryptedToken));
    if (identity.sub !== session.subject) throw new SsoError(401, "sso_identity_mismatch");
    return session.userId;
  } catch (err) {
    if (err instanceof SsoError && err.status === 401) {
      await db.delete(ssoSessionsTable).where(eq(ssoSessionsTable.idHash, session.idHash));
      clearSsoCookie(res, SESSION_COOKIE);
    }
    throw err;
  }
}

// Additive, idempotent startup migration; no modification of existing user data.
export async function initializeSsoStorage() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ncr_sso_identities (
      provider text NOT NULL, subject text NOT NULL,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (provider, subject)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ncr_sso_identity_user_idx ON ncr_sso_identities(provider,user_id);
    CREATE TABLE IF NOT EXISTS ncr_sso_sessions (
      id_hash text PRIMARY KEY, kind text NOT NULL, state_hash text,
      user_id integer REFERENCES users(id) ON DELETE CASCADE,
      subject text, provider text NOT NULL, encrypted_token text,
      next_path text NOT NULL DEFAULT '/ledger', expires_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ncr_sso_sessions_expiry_idx ON ncr_sso_sessions(expires_at);
  `);
}

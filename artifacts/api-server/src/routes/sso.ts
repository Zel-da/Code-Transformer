import { Router, type IRouter } from "express";
import { and, eq, lt } from "drizzle-orm";
import { db, ssoSessionsTable, usersTable } from "@workspace/db";
import {
  getSsoConfig, cookie, setSsoCookie, clearSsoCookie, SESSION_COOKIE, STATE_COOKIE,
  digest, randomId, safeNext, sameHash, exchangeCode, mapIdentity, encryptToken, SsoError,
} from "../lib/sso";

const router: IRouter = Router();
const errors: Record<string, string> = {
  sso_access_denied: "NCR에 등록된 활성 계정만 사용할 수 있습니다. 관리자에게 계정 등록을 요청하세요.",
  sso_identity_already_linked: "다른 중앙 계정에 연결된 NCR 계정입니다. 관리자에게 문의하세요.",
  sso_invalid_state: "로그인 요청이 만료되었거나 일치하지 않습니다. SSO 로그인을 다시 시작하세요.",
};

router.get("/auth/sso/config", (_req, res) => {
  res.set("Cache-Control", "no-store");
  try { res.json({ enabled: !!getSsoConfig() }); }
  catch { res.json({ enabled: false }); }
});

router.get("/auth/sso/login", async (req, res): Promise<void> => {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  const config = getSsoConfig();
  if (!config) {
    res.status(503).send("SSO 설정이 아직 완료되지 않았습니다. 기존 로그인 방식을 사용하세요.");
    return;
  }
  const pendingId = randomId();
  const state = randomId();
  const previous = cookie(req, STATE_COOKIE);
  if (previous) await db.delete(ssoSessionsTable).where(and(
    eq(ssoSessionsTable.idHash, digest(previous)), eq(ssoSessionsTable.kind, "login")));
  await db.delete(ssoSessionsTable).where(lt(ssoSessionsTable.expiresAt, new Date()));
  await db.insert(ssoSessionsTable).values({
    idHash: digest(pendingId), kind: "login", stateHash: digest(state), provider: config.base,
    nextPath: safeNext(req.query.next), expiresAt: new Date(Date.now() + 300000),
  });
  setSsoCookie(res, STATE_COOKIE, pendingId, 300000);
  const url = new URL(`${config.base}/sso/authorize`);
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.callback,
    response_type: "code", state }).toString();
  res.redirect(302, url.href);
});

router.get("/auth/sso/callback", async (req, res): Promise<void> => {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  const config = getSsoConfig();
  if (!config) { res.status(503).send("SSO 설정이 필요합니다."); return; }
  try {
    const id = cookie(req, STATE_COOKIE);
    clearSsoCookie(res, STATE_COOKIE);
    if (!id) throw new SsoError(400, "sso_invalid_state");
    // Atomic consume makes callback replay fail across all instances.
    const [pending] = await db.delete(ssoSessionsTable).where(and(
      eq(ssoSessionsTable.idHash, digest(id)), eq(ssoSessionsTable.kind, "login"),
    )).returning();
    if (!pending?.stateHash || pending.provider !== config.base || pending.expiresAt.getTime() <= Date.now() ||
        typeof req.query.state !== "string" || !sameHash(pending.stateHash, digest(req.query.state)) ||
        typeof req.query.code !== "string" || !req.query.code || req.query.code.length > 4096) {
      throw new SsoError(400, "sso_invalid_state");
    }
    const { identity, token } = await exchangeCode(req.query.code);
    const userId = await mapIdentity(identity);
    const [user] = await db.select({ active: usersTable.isActive }).from(usersTable).where(eq(usersTable.id, userId));
    if (!user?.active) throw new SsoError(403, "sso_access_denied");
    const oldId = cookie(req, SESSION_COOKIE);
    if (oldId) await db.delete(ssoSessionsTable).where(eq(ssoSessionsTable.idHash, digest(oldId)));
    const sessionId = randomId();
    const ttl = token.expires_in * 1000;
    await db.insert(ssoSessionsTable).values({
      idHash: digest(sessionId), kind: "auth", userId, subject: identity.sub, provider: config.base,
      encryptedToken: encryptToken(token.access_token), expiresAt: new Date(Date.now() + ttl),
    });
    setSsoCookie(res, SESSION_COOKIE, sessionId, ttl);
    const destination = new URL("/login", config.app);
    destination.search = new URLSearchParams({ sso: "complete", redirect: safeNext(pending.nextPath) }).toString();
    res.redirect(303, destination.href);
  } catch (err) {
    // Never log the exception, callback URL, code, cookie, token, or provider response.
    const code = err instanceof SsoError ? err.code : "sso_failed";
    const status = err instanceof SsoError ? err.status : 502;
    req.log.warn({ stage: code, status }, "SSO login rejected");
    res.status(status).type("html").send(
      `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SSO 로그인 안내</title><body><h1>SSO 로그인 실패</h1><p>${errors[code] ?? "중앙 인증을 완료할 수 없습니다. 잠시 후 다시 시도하세요."}</p><a href="/login">로그인 화면으로 돌아가기</a></body></html>`);
  }
});

router.post("/auth/sso/logout", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const config = getSsoConfig();
  if (config && req.get("origin") !== config.app) {
    res.status(403).json({ error: "invalid_origin" }); return;
  }
  for (const name of [SESSION_COOKIE, STATE_COOKIE]) {
    const id = cookie(req, name);
    if (id) await db.delete(ssoSessionsTable).where(eq(ssoSessionsTable.idHash, digest(id)));
    clearSsoCookie(res, name);
  }
  res.json({ ok: true });
});

export default router;

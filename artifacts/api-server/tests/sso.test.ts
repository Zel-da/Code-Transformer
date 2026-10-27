import express from "express";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, ssoIdentitiesTable, ssoSessionsTable, usersTable } from "@workspace/db";
import ssoRouter from "../src/routes/sso";
import { requireAuth, requireAdmin } from "../src/middleware/requireAuth";
import { digest, initializeSsoStorage, safeNext, STATE_COOKIE, SESSION_COOKIE } from "../src/lib/sso";

const suffix = randomBytes(8).toString("hex");
const provider = `https://sso-test-${suffix}.invalid`;
const origin = "https://ncr-test.invalid";
const fixtureEmail = `sso-${suffix}@example.invalid`;
const identity = { sub: "987654321", email: fixtureEmail, is_active: true, system_role: "ADMIN" };
let userId: number;
let returnedAudience = "fixture-client";
let returnedSub = identity.sub;
let providerStatus = 200;
let tokenStatus = 200;
const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
  const endpoint = String(url);
  if (endpoint.endsWith("/token")) {
    return new Response(JSON.stringify({ access_token: "fixture-token", token_type: "Bearer", expires_in: 3600,
      user: { sub: returnedSub, aud: returnedAudience } }), { status: tokenStatus });
  }
  return new Response(JSON.stringify(identity), { status: providerStatus });
});
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.log = { warn: () => {} } as any; next(); });
app.use("/api", ssoRouter);
app.get("/protected", requireAuth, (req, res) => res.json(req.auth));
app.get("/admin", requireAdmin, (_req, res) => res.json({ ok: true }));
const cookieHeader = (res: request.Response, name: string) =>
  (res.headers["set-cookie"] as unknown as string[]).find(s => s.startsWith(`${name}=`))!.split(";")[0];

async function start() {
  const res = await request(app).get("/api/auth/sso/login?next=/submit").expect(302);
  const url = new URL(res.headers.location);
  return { state: url.searchParams.get("state")!, cookie: cookieHeader(res, STATE_COOKIE), url };
}
async function callback(pending: Awaited<ReturnType<typeof start>>, state = pending.state) {
  return request(app).get("/api/auth/sso/callback").query({ code: "fixture-code", state }).set("Cookie", pending.cookie);
}
async function login() {
  const res = await callback(await start());
  expect(res.status).toBe(303);
  return cookieHeader(res, SESSION_COOKIE);
}

beforeAll(async () => {
  // Dedicated fixture configuration; never contact a real provider.
  vi.stubEnv("SSO_BASE_URL", provider);
  vi.stubEnv("APP_BASE_URL", origin);
  vi.stubEnv("SSO_CLIENT_ID", "fixture-client");
  vi.stubEnv("SSO_CLIENT_SECRET", "fixture-secret-not-a-real-credential");
  vi.stubEnv("SESSION_SECRET", "sso-fixture-encryption-not-a-real-credential");
  vi.stubGlobal("fetch", fetchMock);
  await initializeSsoStorage();
  const [user] = await db.insert(usersTable).values({
    username: `sso-${suffix}`, email: fixtureEmail, displayName: "SSO test fixture",
    passwordHash: "not-a-login-hash", role: "worker", isActive: true, notifyLevel: "none",
  }).returning({ id: usersTable.id });
  userId = user.id;
});
beforeEach(async () => {
  returnedAudience = "fixture-client"; returnedSub = identity.sub; providerStatus = 200; tokenStatus = 200;
  identity.email = fixtureEmail; identity.is_active = true;
  fetchMock.mockClear();
  await db.delete(ssoSessionsTable).where(eq(ssoSessionsTable.provider, provider));
  await db.delete(ssoIdentitiesTable).where(eq(ssoIdentitiesTable.provider, provider));
  await db.update(usersTable).set({ isActive: true, role: "worker" }).where(eq(usersTable.id, userId));
});
afterAll(async () => {
  await db.delete(ssoSessionsTable).where(eq(ssoSessionsTable.provider, provider));
  await db.delete(ssoIdentitiesTable).where(eq(ssoIdentitiesTable.provider, provider));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe("DX SSO security flow", () => {
  it("constructs an exact callback, safe return target and secure HttpOnly state cookie", async () => {
    const pending = await start();
    expect(pending.url.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/sso/callback`);
    expect(pending.state).toMatch(/^[a-f0-9]{64}$/);
    const res = await request(app).get("/api/auth/sso/login");
    expect(String(res.headers["set-cookie"])).toContain("HttpOnly");
    expect(String(res.headers["set-cookie"])).toContain("Secure");
    expect(String(res.headers["set-cookie"])).toContain("SameSite=Lax");
    expect(safeNext("//evil.invalid")).toBe("/ledger");
    expect(safeNext("/submit")).toBe("/submit");
  });
  it("rejects missing, modified and replayed state without provider calls", async () => {
    await request(app).get("/api/auth/sso/callback?code=fixture&state=missing").expect(400);
    const pending = await start();
    expect((await callback(pending, "modified")).status).toBe(400);
    expect((await callback(pending)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects expired state", async () => {
    const pending = await start();
    const value = pending.cookie.split("=")[1];
    await db.update(ssoSessionsTable).set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(ssoSessionsTable.idHash, digest(value)));
    expect((await callback(pending)).status).toBe(400);
  });
  it("invalidates the earlier start in the same browser without exchanging its code", async () => {
    const earlier = await start();
    const newer = await request(app).get("/api/auth/sso/login").set("Cookie", earlier.cookie).expect(302);
    expect(new URL(newer.headers.location).searchParams.get("state")).not.toBe(earlier.state);
    expect((await callback(earlier)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("exchanges once with the same redirect URI and explicit authorization_code grant", async () => {
    const pending = await start();
    const res = await callback(pending);
    expect(res.status).toBe(303);
    const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/token"));
    expect(calls).toHaveLength(1);
    const init = calls[0][1]!;
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.grant_type).toBe("authorization_code");
    expect(body.redirect_uri).toBe(pending.url.searchParams.get("redirect_uri"));
    expect(new URL(res.headers.location).searchParams.get("sso")).toBe("complete");
    await request(app).get("/protected").set("Cookie", cookieHeader(res, SESSION_COOKIE)).expect(200);
    expect((await callback(pending)).status).toBe(400);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/token"))).toHaveLength(1);
  });
  it("does not retry an expired or reused code rejected by the provider", async () => {
    tokenStatus = 401;
    const pending = await start();
    const res = await callback(pending);
    expect(res.status).toBe(401);
    expect(String(res.headers["set-cookie"])).not.toContain(`${SESSION_COOKIE}=`);
    expect((await callback(pending)).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects expired app sessions before contacting the provider", async () => {
    const sessionCookie = await login();
    await db.update(ssoSessionsTable).set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(ssoSessionsTable.idHash, digest(sessionCookie.split("=")[1])));
    fetchMock.mockClear();
    await request(app).get("/protected").set("Cookie", sessionCookie).expect(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects mismatched client audience", async () => {
    returnedAudience = "other-client";
    expect((await callback(await start())).status).toBe(401);
  });
  it("rejects mismatched subjects", async () => {
    returnedSub = "123";
    expect((await callback(await start())).status).toBe(401);
  });
  it("rejects unregistered users without auto-provisioning", async () => {
    identity.email = `unknown-${suffix}@example.invalid`;
    expect((await callback(await start())).status).toBe(403);
  });
  it("rejects inactive local users", async () => {
    await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, userId));
    expect((await callback(await start())).status).toBe(403);
  });
  it("creates opaque sessions without exposing provider credentials, preserves local worker role", async () => {
    const sessionCookie = await login();
    expect(sessionCookie).not.toContain("fixture-token");
    const res = await request(app).get("/protected").set("Cookie", sessionCookie).expect(200);
    expect(res.body.role).toBe("worker"); // central ADMIN must NOT elevate this user
    await request(app).get("/admin").set("Cookie", sessionCookie).expect(403);
    const [session] = await db.select().from(ssoSessionsTable)
      .where(and(eq(ssoSessionsTable.provider, provider), eq(ssoSessionsTable.kind, "auth")));
    expect(session.encryptedToken).not.toContain("fixture-token");
  });
  it("rechecks current local role and rejects local deactivation", async () => {
    const sessionCookie = await login();
    await db.update(usersTable).set({ role: "reviewer" }).where(eq(usersTable.id, userId));
    const res = await request(app).get("/protected").set("Cookie", sessionCookie).expect(200);
    expect(res.body.role).toBe("reviewer");
    await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, userId));
    await request(app).get("/protected").set("Cookie", sessionCookie).expect(401);
  });
  it("fails closed during provider outage without silently reusing cached identity", async () => {
    const sessionCookie = await login();
    fetchMock.mockRejectedValueOnce(new Error("fixture outage"));
    await request(app).get("/protected").set("Cookie", sessionCookie).expect(503);
  });
  it("destroys session when central account is rejected", async () => {
    const sessionCookie = await login();
    providerStatus = 401;
    await request(app).get("/protected").set("Cookie", sessionCookie).expect(401);
    providerStatus = 200;
    await request(app).get("/protected").set("Cookie", sessionCookie).expect(401);
  });
  it("enforces same-origin logout and invalidates the old session", async () => {
    const sessionCookie = await login();
    await request(app).post("/api/auth/sso/logout").set("Cookie", sessionCookie).set("Origin", "https://evil.invalid").expect(403);
    await request(app).post("/api/auth/sso/logout").set("Cookie", sessionCookie).set("Origin", origin).expect(200);
    await request(app).get("/protected").set("Cookie", sessionCookie).expect(401);
    const newCookie = await login();
    expect(newCookie).not.toBe(sessionCookie);
    await request(app).get("/protected").set("Cookie", newCookie).expect(200);
  });
});

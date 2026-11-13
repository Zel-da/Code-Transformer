import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import reportsRouter from "../src/routes/reports";
import usersRouter from "../src/routes/users";
import { signToken, type UserRole } from "../src/middleware/requireAuth";

const fixture = vi.hoisted(() => ({
  role: "worker" as string,
  active: true,
  report: { id: 123, qcStatus: "IN_REVIEW", qualityOpinion: "original", description: "fixture" },
  itemCodeProblem: null as null | { code: string; error: string },
}));

// Exercise real authentication/role middleware and route handlers without DB writes
// or external notifications. The current DB role may differ from the token claim.
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: vi.fn((columns?: Record<string, unknown>) => {
        let table: unknown;
        const rows = () => {
          if (table !== actual.usersTable) return [fixture.report];
          const user = {
            id: 1, username: "fixture", displayName: "Fixture", role: fixture.role,
            isActive: fixture.active, tempPasswordHash: null, tempPasswordVersion: 0,
            email: "private@example.invalid", hasTempPassword: false,
          };
          return [columns
            ? Object.fromEntries(Object.keys(columns).map(k => [k, user[k as keyof typeof user]]))
            : user];
        };
        const query: any = {
          from: (value: unknown) => { table = value; return query; },
          where: vi.fn(() => query),
          orderBy: () => query,
          limit: () => query,
          offset: () => query,
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(rows()).then(resolve, reject),
        };
        return query;
      }),
      update: vi.fn(() => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              Object.assign(fixture.report, values);
              return [fixture.report];
            },
          }),
        }),
      })),
    },
  };
});
vi.mock("../src/lib/audit", () => ({
  writeAuditLog: vi.fn(),
  diffObjects: () => ({ before: {}, after: {} }),
}));
vi.mock("../src/lib/notifications", () => ({ notifyStatusTransition: vi.fn() }));
vi.mock("../src/lib/itemCodeGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/itemCodeGuard")>()),
  findApprovalItemCodeProblem: vi.fn(async () => fixture.itemCodeProblem),
}));

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.log = { info: () => {} } as any; next(); });
app.use("/api", reportsRouter, usersRouter);
const token = (role: UserRole) => signToken({
  userId: 1, username: "fixture", role, authMethod: "internal",
});
const roles: UserRole[] = ["admin", "reviewer", "approver", "worker", "collaborator"];
const qcRoles: UserRole[] = ["admin", "reviewer", "approver"];
beforeEach(() => {
  fixture.role = "worker";
  fixture.active = true;
  fixture.report = { id: 123, qcStatus: "IN_REVIEW", qualityOpinion: "original", description: "fixture" };
  vi.clearAllMocks();
});

describe("QC API role boundary", () => {
  const writes = [
    ["put", "/api/reports/123/qc", { qualityOpinion: "bypass" }],
    ["post", "/api/reports/123/qc-action", { qcAction: "APPROVED" }],
    ["patch", "/api/reports/123/status", { status: "RESOLVED" }],
    ["delete", "/api/reports/123", {}],
  ] as const;
  it.each(writes)("requires authentication for %s %s", async (method, path, body) => {
    await request(app)[method](path).send(body).expect(401);
    expect(db.update).not.toHaveBeenCalled();
  });
  it.each(["worker", "collaborator"] as UserRole[])("rejects every QC write for %s", async role => {
    fixture.role = role;
    for (const [method, path, body] of writes) {
      await request(app)[method](path).auth(token(role), { type: "bearer" }).send(body).expect(403);
    }
    expect(db.update).not.toHaveBeenCalled();
    expect(fixture.report.qualityOpinion).toBe("original");
  });
  it.each(qcRoles)("allows %s to save QC analysis", async role => {
    fixture.role = role;
    await request(app).put("/api/reports/123/qc")
      .auth(token(role), { type: "bearer" }).send({ qualityOpinion: "saved" })
      .expect(200).expect(res => expect(res.body.qualityOpinion).toBe("saved"));
    expect(db.update).toHaveBeenCalledOnce();
  });
  it.each(roles)("keeps general report detail readable by %s", async role => {
    fixture.role = role;
    await request(app).get("/api/reports/123").auth(token(role), { type: "bearer" }).expect(200);
    await request(app).get("/api/reports").auth(token(role), { type: "bearer" }).expect(200);
  });
  it.each(["worker", "collaborator"] as UserRole[])("does not save QC fields through general update for %s", async role => {
    fixture.role = role;
    await request(app).put("/api/reports/123").auth(token(role), { type: "bearer" })
      .send({ description: "general edit", qualityOpinion: "bypass", qcStatus: "APPROVED", qcAction: "APPROVED" })
      .expect(200);
    expect(fixture.report.description).toBe("general edit");
    expect(fixture.report.qualityOpinion).toBe("original");
    expect(fixture.report.qcStatus).toBe("IN_REVIEW");
    expect(fixture.report).not.toHaveProperty("qcAction");
  });
  it("uses the current role rather than a stale administrator token", async () => {
    fixture.role = "worker";
    await request(app).put("/api/reports/123/qc").auth(token("admin"), { type: "bearer" })
      .send({ qualityOpinion: "bypass" }).expect(403);
    expect(db.update).not.toHaveBeenCalled();
  });
  it("keeps final approval exclusive to approver, not admin or reviewer", async () => {
    fixture.report.qcStatus = "RESOLVED";
    for (const role of ["admin", "reviewer"] as UserRole[]) {
      fixture.role = role;
      await request(app).patch("/api/reports/123/status").auth(token(role), { type: "bearer" })
        .send({ status: "APPROVED" }).expect(403);
    }
    expect(db.update).not.toHaveBeenCalled();
  });
  it.each(qcRoles)("allows %s to start review per existing transition matrix", async role => {
    fixture.role = role;
    fixture.report.qcStatus = "OPEN";
    await request(app).patch("/api/reports/123/status").auth(token(role), { type: "bearer" })
      .send({ status: "IN_REVIEW" }).expect(200);
    expect(fixture.report.qcStatus).toBe("IN_REVIEW");
  });
  it("allows approver final approval", async () => {
    fixture.role = "approver";
    fixture.report.qcStatus = "RESOLVED";
    await request(app).patch("/api/reports/123/status").auth(token("approver"), { type: "bearer" })
      .send({ status: "APPROVED" }).expect(200);
    expect(fixture.report.qcStatus).toBe("APPROVED");
  });
  it("blocks final approval while the item code is temporary", async () => {
    fixture.role = "approver";
    fixture.report.qcStatus = "RESOLVED";
    fixture.itemCodeProblem = { code: "ITEM_CODE_REQUIRED", error: "temporary item code" };
    try {
      const res = await request(app).patch("/api/reports/123/status").auth(token("approver"), { type: "bearer" })
        .send({ status: "APPROVED" }).expect(400);
      expect(res.body.code).toBe("ITEM_CODE_REQUIRED");
      expect(fixture.report.qcStatus).toBe("RESOLVED");
    } finally {
      fixture.itemCodeProblem = null;
    }
  });
});

describe("minimal collaboration directory", () => {
  it("requires authentication", async () => {
    await request(app).get("/api/users/directory").expect(401);
  });
  it.each(roles)("allows %s only the minimal active-user projection", async role => {
    fixture.role = role;
    const res = await request(app).get("/api/users/directory")
      .auth(token(role), { type: "bearer" }).expect(200);
    expect(Object.keys(res.body[0]).sort()).toEqual(["displayName", "id", "isActive", "role", "username"]);
    expect(db.select).toHaveBeenLastCalledWith({
      id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName,
      role: usersTable.role, isActive: usersTable.isActive,
    });
    const query = vi.mocked(db.select).mock.results.at(-1)!.value;
    expect(query.where).toHaveBeenCalledWith(eq(usersTable.isActive, true));
  });
  it.each(["worker", "collaborator", "reviewer", "approver"] as UserRole[])(
    "does not open administrator user APIs to %s", async role => {
      fixture.role = role;
      await request(app).get("/api/users").auth(token(role), { type: "bearer" }).expect(403);
      await request(app).post("/api/users").auth(token(role), { type: "bearer" }).send({}).expect(403);
      await request(app).put("/api/users/2").auth(token(role), { type: "bearer" }).send({ role: "admin" }).expect(403);
    },
  );
  it("rejects an inactive account", async () => {
    fixture.active = false;
    await request(app).get("/api/users/directory").auth(token("reviewer"), { type: "bearer" }).expect(401);
  });
});

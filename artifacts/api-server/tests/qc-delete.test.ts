import express from "express";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, usersTable, nonConformityReportsTable as reports, auditLogsTable, reportCommentsTable } from "@workspace/db";
import router from "../src/routes/reports";
import { signToken, type UserRole } from "../src/middleware/requireAuth";

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.log = { info: () => {} } as any; next(); });
app.use("/api", router);
const prefix = `qc-delete-${randomBytes(6).toString("hex")}`;
const tokens: Partial<Record<UserRole, string>> = {};
const userIds: number[] = [];
const ids: number[] = [];
async function fixture(extra: Partial<typeof reports.$inferInsert> = {}) {
  const [row] = await db.insert(reports).values({
    itemCode: prefix, processName: "테스트", defectType: "테스트", description: prefix,
    qcStatus: "IN_REVIEW", syncStatus: "PENDING", ...extra,
  }).returning();
  ids.push(row.id);
  return row;
}
beforeAll(async () => {
  for (const role of ["admin", "reviewer", "approver", "worker", "collaborator"] as UserRole[]) {
    const [u] = await db.insert(usersTable).values({
      username: `${prefix}-${role}`, displayName: prefix, passwordHash: "not-a-login-hash",
      role, isActive: true, notifyLevel: "none",
    }).returning();
    userIds.push(u.id);
    tokens[role] = signToken({ userId: u.id, username: u.username, role, authMethod: "internal" });
  }
});
afterAll(async () => {
  if (ids.length) {
    await db.delete(reports).where(inArray(reports.id, ids));
    await db.delete(auditLogsTable).where(and(eq(auditLogsTable.targetType, "report"), inArray(auditLogsTable.targetId, ids)));
  }
  if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
});
const remove = (id: number, role: UserRole) => request(app).delete(`/api/reports/${id}`).auth(tokens[role]!, { type: "bearer" });
describe("QC report deletion", () => {
  it("rejects unauthenticated, worker and collaborator callers without deleting", async () => {
    const row = await fixture();
    await request(app).delete(`/api/reports/${row.id}`).expect(401);
    await remove(row.id, "worker").expect(403);
    await remove(row.id, "collaborator").expect(403);
    expect(await db.select().from(reports).where(eq(reports.id, row.id))).toHaveLength(1);
  });
  it.each(["admin", "reviewer", "approver"] as UserRole[])("allows %s to delete an eligible report and retains audit snapshot", async role => {
    const row = await fixture();
    await db.insert(reportCommentsTable).values({ reportId: row.id, authorName: prefix, body: prefix });
    await remove(row.id, role).expect(204);
    expect(await db.select().from(reports).where(eq(reports.id, row.id))).toHaveLength(0);
    expect(await db.select().from(reportCommentsTable).where(eq(reportCommentsTable.reportId, row.id))).toHaveLength(0);
    const [audit] = await db.select().from(auditLogsTable).where(and(eq(auditLogsTable.targetId, row.id), eq(auditLogsTable.action, "delete_report")));
    expect(audit.beforeVal).toMatchObject({ id: row.id, description: prefix });
    await remove(row.id, role).expect(404);
  });
  it.each(["OPEN", "PENDING_COLLAB", "RESOLVED", "APPROVED", "ERP_SYNCED", null] as const)("blocks non-review status %s even for admin", async qcStatus => {
    const row = await fixture({ qcStatus });
    await remove(row.id, "admin").expect(409);
    expect(await db.select().from(reports).where(eq(reports.id, row.id))).toHaveLength(1);
  });
  it.each([
    { isLocked: true },
    { syncStatus: "PROCESSING" as const },
    { syncStatus: "COMPLETED" as const },
    { syncStatus: "FAILED" as const },
    { syncAttemptCount: 1 },
  ])("blocks protected report %j", async extra => {
    const row = await fixture(extra);
    await remove(row.id, "reviewer").expect(409);
    expect(await db.select().from(reports).where(eq(reports.id, row.id))).toHaveLength(1);
  });
  it("allows ERP REVIEW before any processing attempt", async () => {
    const row = await fixture({ syncStatus: "REVIEW" });
    await remove(row.id, "reviewer").expect(204);
  });
});

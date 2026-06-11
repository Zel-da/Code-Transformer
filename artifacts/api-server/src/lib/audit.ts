import { db, auditLogsTable } from "@workspace/db";
import { logger } from "./logger.js";

export interface AuditOptions {
  actorId: number;
  actorName: string;
  action: string;
  targetType: string;
  targetId?: number;
  detail?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export async function writeAuditLog(opts: AuditOptions): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      actorId: opts.actorId,
      actorName: opts.actorName,
      action: opts.action,
      targetType: opts.targetType,
      targetId: opts.targetId ?? null,
      detail: opts.detail ?? null,
      beforeVal: opts.before ?? null,
      afterVal: opts.after ?? null,
    });
  } catch (err) {
    logger.error({ err, opts }, "audit log insert failed");
  }
}

export function diffObjects(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    const bv = before[key];
    const av = after[key];
    const bStr = bv instanceof Date ? bv.toISOString() : JSON.stringify(bv);
    const aStr = av instanceof Date ? av.toISOString() : JSON.stringify(av);
    if (bStr !== aStr) {
      changedBefore[key] = bv;
      changedAfter[key] = av;
    }
  }
  return { before: changedBefore, after: changedAfter };
}

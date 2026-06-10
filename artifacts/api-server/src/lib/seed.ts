import {
  db,
  itemCodesTable,
  plantsTable,
  flawTypesTable,
  processesTable,
  dispositionsTable,
  departmentsTable,
  usersTable,
  nonConformityReportsTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import bcrypt from "bcryptjs";
import {
  ITEM_MASTER_SEED,
  PLANT_SEED,
  FLAW_TYPE_SEED,
  PROCESS_SEED,
  DISPOSITION_SEED,
  DEPT_SEED,
} from "./masterSeedData";

/**
 * Task #35: 레거시 한국어 qcStatus 값을 영문 enum으로 일회성 마이그레이션 (idempotent).
 * 이미 영문인 행은 영향 없음.
 */
async function migrateQcStatusToEnglish(): Promise<void> {
  try {
    const result = await db.execute(sql`
      UPDATE non_conformity_reports
      SET qc_status = CASE qc_status
        WHEN '접수'    THEN 'OPEN'
        WHEN '분석 중' THEN 'IN_REVIEW'
        WHEN '조치 완료' THEN 'RESOLVED'
        WHEN '종결'    THEN 'APPROVED'
        ELSE qc_status
      END
      WHERE qc_status IN ('접수', '분석 중', '조치 완료', '종결')
    `);
    const count = (result as { rowCount?: number })?.rowCount ?? 0;
    if (count > 0) {
      logger.info({ count }, "Migrated legacy Korean qcStatus values to English enum (Task #35)");
    }
  } catch (err) {
    logger.error({ err }, "Failed to migrate qcStatus values");
  }
}

export async function seedMasterData(): Promise<void> {
  try {
    await migrateQcStatusToEnglish();
    await db.insert(plantsTable).values(PLANT_SEED).onConflictDoNothing({ target: plantsTable.plantCd });
    await db.insert(flawTypesTable).values(FLAW_TYPE_SEED).onConflictDoNothing({ target: flawTypesTable.typeCd });
    await db.insert(processesTable).values(PROCESS_SEED).onConflictDoNothing();
    await db.insert(dispositionsTable).values(DISPOSITION_SEED).onConflictDoNothing({ target: dispositionsTable.dispositionCd });
    await db.insert(departmentsTable).values(DEPT_SEED).onConflictDoNothing({ target: departmentsTable.deptCd });
    const batchSize = 100;
    for (let i = 0; i < ITEM_MASTER_SEED.length; i += batchSize) {
      await db
        .insert(itemCodesTable)
        .values(ITEM_MASTER_SEED.slice(i, i + batchSize))
        .onConflictDoNothing({ target: itemCodesTable.code });
    }
    await seedDefaultAdmin();
    logger.info("Master data seeded (idempotent)");
  } catch (err) {
    logger.error({ err }, "Failed to seed master data");
  }
}

async function seedDefaultAdmin(): Promise<void> {
  try {
    const hash = await bcrypt.hash("admin1234", 10);
    await db
      .insert(usersTable)
      .values({
        username: "admin",
        passwordHash: hash,
        displayName: "관리자",
        role: "admin",
      })
      .onConflictDoNothing({ target: usersTable.username });
    logger.info("Default admin seeded (idempotent)");
  } catch (err) {
    logger.error({ err }, "Failed to seed default admin");
  }
}

export async function seedItemCodes(): Promise<void> {
  return seedMasterData();
}

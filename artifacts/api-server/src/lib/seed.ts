import {
  db,
  itemCodesTable,
  plantsTable,
  flawTypesTable,
  processesTable,
  dispositionsTable,
  departmentsTable,
} from "@workspace/db";
import { logger } from "./logger";
import {
  ITEM_MASTER_SEED,
  PLANT_SEED,
  FLAW_TYPE_SEED,
  PROCESS_SEED,
  DISPOSITION_SEED,
  DEPT_SEED,
} from "./masterSeedData";

export async function seedMasterData(): Promise<void> {
  try {
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
    logger.info("Master data seeded (idempotent)");
  } catch (err) {
    logger.error({ err }, "Failed to seed master data");
  }
}

export async function seedItemCodes(): Promise<void> {
  return seedMasterData();
}

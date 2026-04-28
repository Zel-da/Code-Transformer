import { db, itemCodesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const ITEM_CODES = [
  { code: "ITM-001", name: "알루미늄 프레임 A형", category: "금속 부품" },
  { code: "ITM-002", name: "스테인리스 볼트 M10", category: "체결 부품" },
  { code: "ITM-003", name: "고무 씰 Ø50mm", category: "밀봉 부품" },
  { code: "ITM-004", name: "구리 배선 2.5sq", category: "전기 부품" },
  { code: "ITM-005", name: "폴리카보네이트 커버", category: "플라스틱 부품" },
  { code: "ITM-006", name: "철제 브래킷 B형", category: "금속 부품" },
  { code: "ITM-007", name: "유리섬유 단열재", category: "단열 부품" },
  { code: "ITM-008", name: "LED 모듈 24V", category: "전기 부품" },
  { code: "ITM-009", name: "나일론 부싱 Ø30", category: "플라스틱 부품" },
  { code: "ITM-010", name: "스프링강 와셔 Ø20", category: "체결 부품" },
];

export async function seedItemCodes(): Promise<void> {
  try {
    await db
      .insert(itemCodesTable)
      .values(ITEM_CODES)
      .onConflictDoNothing({ target: itemCodesTable.code });
    logger.info("Item codes seeded (idempotent)");
  } catch (err) {
    logger.error({ err }, "Failed to seed item codes");
  }
}

import { eq, sql, type SQL } from "drizzle-orm";
import { db, itemCodesTable, nonConformityReportsTable } from "@workspace/db";

// 화성 간소화 폼은 품번을 모르면 기종명이나 '미정'을 임시 품번으로 저장한다.
// 이런 임시 품번이 ERP(UNIERP)로 넘어가지 않도록, 승인 경로(웹 PATCH·수산톡 버튼)와
// RPA 조회 경로(/reports/pending·/rpa/trigger·rpa-ncr db_source)가 모두 같은 기준을 쓴다.
export const PLACEHOLDER_ITEM_CODE = "미정";

export type ItemCodeProblem = {
  code: "ITEM_CODE_REQUIRED" | "ITEM_CODE_NOT_IN_MASTER";
  error: string;
};

export async function findApprovalItemCodeProblem(
  itemCode: string | null | undefined,
): Promise<ItemCodeProblem | null> {
  const code = (itemCode ?? "").trim();
  if (!code || code === PLACEHOLDER_ITEM_CODE) {
    return {
      code: "ITEM_CODE_REQUIRED",
      error: "품번이 비어있거나 '미정'입니다. 승인 전에 보고서 편집에서 정확한 ERP 품번으로 수정해주세요.",
    };
  }
  const [exists] = await db
    .select({ code: itemCodesTable.code })
    .from(itemCodesTable)
    .where(eq(itemCodesTable.code, code))
    .limit(1);
  if (!exists) {
    return {
      code: "ITEM_CODE_NOT_IN_MASTER",
      error: `품번 "${code}"가 ERP 품목 마스터에 없습니다. 품번 조회에서 정확한 코드를 찾아 수정 후 다시 승인해주세요.`,
    };
  }
  return null;
}

// RPA 전송 대상 조회용 조건: 품번이 실제 ERP 품목 마스터에 있는 보고만.
export function erpReadyItemCodeCondition(): SQL {
  return sql`(${nonConformityReportsTable.itemCode} <> ${PLACEHOLDER_ITEM_CODE}
    AND EXISTS (SELECT 1 FROM ${itemCodesTable} WHERE ${itemCodesTable.code} = ${nonConformityReportsTable.itemCode}))`;
}

import { Router, type IRouter } from "express";
import { eq, and, or, ilike, asc, sql } from "drizzle-orm";
import { db, itemCodesTable, productionOrdersTable } from "@workspace/db";

const router: IRouter = Router();

// 공장 코드 → NCR 폼 공장값 (submit.tsx FACTORY_OPTIONS 기준)
const PLANT_TO_FACTORY: Record<string, string> = { SA00: "아산", SH00: "화성" };

type ItemRow = typeof itemCodesTable.$inferSelect;

function buildResult(item: ItemRow, hogi: number | null, orders: (typeof productionOrdersTable.$inferSelect)[]) {
  const plantCd = orders[0]?.plantCd ?? null;
  return {
    ok: true,
    itemCode: item.code,
    modelName: item.name,
    itemGroup: item.category,
    itemGroupCd: null as string | null, // Neon item_codes는 그룹명(category)만 보유
    spec: null as string | null,
    factory: plantCd ? PLANT_TO_FACTORY[plantCd] ?? null : null,
    plantCd,
    shipmentUnit: hogi != null ? String(hogi) : null,
    matchedOrders: orders.map((o) => ({
      PRODT_ORDER_NO: o.prodtOrderNo,
      ORDER_STATUS: o.orderStatus,
      PLAN_START: o.planStart,
    })),
    orderCount: orders.length,
  };
}

async function ordersFor(itemCode: string, hogi: number | null) {
  if (hogi != null) {
    return db
      .select()
      .from(productionOrdersTable)
      .where(
        and(
          eq(productionOrdersTable.itemCode, itemCode),
          sql`${hogi} BETWEEN ${productionOrdersTable.hogiFrom} AND ${productionOrdersTable.hogiTo}`,
        ),
      )
      .orderBy(asc(productionOrdersTable.hogiFrom));
  }
  return db
    .select()
    .from(productionOrdersTable)
    .where(eq(productionOrdersTable.itemCode, itemCode))
    .limit(50);
}

// 제품(품번/품명) + 출하호기 → NCR 자동입력 데이터 (Neon 미러에서 조회)
router.get("/erp/input-data", async (req, res): Promise<void> => {
  const itemCode = (req.query.itemCode as string | undefined)?.trim();
  const product = (req.query.product as string | undefined)?.trim();
  const hogiRaw = req.query.hogi as string | undefined;
  const hogi = hogiRaw != null && hogiRaw !== "" && !Number.isNaN(Number(hogiRaw)) ? Number(hogiRaw) : null;

  if (!itemCode && !product) {
    res.status(400).json({ ok: false, reason: "itemCode 또는 product 중 하나는 필요합니다." });
    return;
  }

  // 1) 품번 정확일치
  if (itemCode) {
    const [item] = await db.select().from(itemCodesTable).where(eq(itemCodesTable.code, itemCode)).limit(1);
    if (!item) {
      res.json({ ok: false, reason: "품목을 찾지 못함", candidates: [] });
      return;
    }
    res.json(buildResult(item, hogi, await ordersFor(item.code, hogi)));
    return;
  }

  // 2) 제품명/품번 부분일치 — 호기가 있으면 그 호기에 제조오더가 있는 품목으로 좁힘
  const term = `%${product}%`;
  if (hogi != null) {
    const narrowed = await db
      .selectDistinct({
        code: itemCodesTable.code,
        name: itemCodesTable.name,
        category: itemCodesTable.category,
        id: itemCodesTable.id,
        createdAt: itemCodesTable.createdAt,
      })
      .from(itemCodesTable)
      .innerJoin(productionOrdersTable, eq(productionOrdersTable.itemCode, itemCodesTable.code))
      .where(
        and(
          or(ilike(itemCodesTable.code, term), ilike(itemCodesTable.name, term)),
          sql`${hogi} BETWEEN ${productionOrdersTable.hogiFrom} AND ${productionOrdersTable.hogiTo}`,
        ),
      )
      .orderBy(asc(itemCodesTable.code));
    if (narrowed.length === 1) {
      const item = narrowed[0] as ItemRow;
      res.json(buildResult(item, hogi, await ordersFor(item.code, hogi)));
      return;
    }
    if (narrowed.length > 1) {
      res.json({ ok: false, reason: `품목 후보 ${narrowed.length}건 — 품번을 특정하세요`, candidates: narrowed });
      return;
    }
    // 호기 매칭 없음 → 이름만 후보 안내로 폴백
  }

  const candidates = await db
    .select()
    .from(itemCodesTable)
    .where(or(ilike(itemCodesTable.code, term), ilike(itemCodesTable.name, term)))
    .orderBy(asc(itemCodesTable.code))
    .limit(25);

  if (candidates.length === 1) {
    res.json(buildResult(candidates[0], hogi, await ordersFor(candidates[0].code, hogi)));
    return;
  }
  res.json({
    ok: false,
    reason: candidates.length ? `품목 후보 ${candidates.length}건 — 호기 입력 또는 품번 특정` : "품목을 찾지 못함",
    candidates,
  });
});

export default router;

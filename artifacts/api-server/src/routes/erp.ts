import { Router, type IRouter } from "express";
import { eq, and, or, ilike, asc, desc, sql, type SQL } from "drizzle-orm";
import {
  db,
  itemCodesTable,
  productionOrdersTable,
  vendorsTable,
  shipmentsTable,
} from "@workspace/db";

const router: IRouter = Router();

// 공장 코드 → NCR 폼 공장값 (submit.tsx FACTORY_OPTIONS 기준)
const PLANT_TO_FACTORY: Record<string, string> = { SA00: "아산", SH00: "화성" };

type ItemRow = typeof itemCodesTable.$inferSelect;
type VendorMatch = { vendorCd: string; vendorNm: string; taxNo: string | null };

// 한자 로마숫자(Ⅰ~Ⅹ) ↔ 영문 변형. ERP에는 JD-800EⅡ 같은 한자 표기가 섞여 있어
// 사용자가 "JD-800EII"로 쳐도 매칭되도록 검색어를 양방향 변형해 OR로 묶는다.
const ROMAN: ReadonlyArray<readonly [string, string]> = [
  ["Ⅰ", "I"], ["Ⅱ", "II"], ["Ⅲ", "III"], ["Ⅳ", "IV"], ["Ⅴ", "V"],
  ["Ⅵ", "VI"], ["Ⅶ", "VII"], ["Ⅷ", "VIII"], ["Ⅸ", "IX"], ["Ⅹ", "X"],
];
function searchVariants(s: string): string[] {
  const out = new Set<string>([s]);
  let han2eng = s;
  for (const [h, e] of ROMAN) han2eng = han2eng.split(h).join(e);
  out.add(han2eng);
  // 영문→한자: 긴 것 우선(III/IV/IX 등이 II/I보다 먼저 매칭되도록 역순)
  let eng2han = s;
  for (let i = ROMAN.length - 1; i >= 0; i--) {
    const [h, e] = ROMAN[i];
    eng2han = eng2han.split(e).join(h);
  }
  out.add(eng2han);
  return Array.from(out);
}

// 검색어를 code/name/category 3개 컬럼 + 한자/영문 변형 모두에 대해 ILIKE OR.
// vendorNames가 주어지면 item.name에서 그 거래처명도 ILIKE 매칭 (vendor 코드/사업자번호로 검색했을 때
// ITEM_NM에 박힌 거래처명을 통해 제품을 찾기 위함).
function buildProductMatchCondition(term: string, vendorNames: string[] = []): SQL {
  const conds: SQL[] = [];
  for (const v of searchVariants(term)) {
    const like = `%${v}%`;
    conds.push(ilike(itemCodesTable.code, like));
    conds.push(ilike(itemCodesTable.name, like));
    conds.push(ilike(itemCodesTable.category, like));
  }
  for (const nm of vendorNames) {
    if (!nm || nm.length < 2) continue;
    conds.push(ilike(itemCodesTable.name, `%${nm}%`));
  }
  return or(...conds)!;
}

// 검색어(거래처명/코드/사업자번호)로 vendors 매칭. valid_flg=true만, limit으로 폭주 방지.
async function findVendors(term: string, limit = 30): Promise<VendorMatch[]> {
  if (!term || term.length < 1) return [];
  const like = `%${term}%`;
  return db
    .select({
      vendorCd: vendorsTable.vendorCd,
      vendorNm: vendorsTable.vendorNm,
      taxNo: vendorsTable.taxNo,
    })
    .from(vendorsTable)
    .where(
      and(
        eq(vendorsTable.validFlg, true),
        or(
          ilike(vendorsTable.vendorCd, like),
          ilike(vendorsTable.vendorNm, like),
          ilike(vendorsTable.taxNo, like),
        ),
      ),
    )
    .orderBy(asc(vendorsTable.vendorNm))
    .limit(limit);
}

// 단일 item에 대해 vendor 매칭 후보 중 가장 가능성 높은 1건 추출.
// 우선순위: 매칭 1건이면 그 거래처 / 다건이면 ITEM_NM에 박힌 거래처명 우선.
function pickVendorForItem(item: ItemRow, vendors: VendorMatch[]): VendorMatch | null {
  if (vendors.length === 0) return null;
  if (vendors.length === 1) return vendors[0];
  const itemNm = item.name ?? "";
  return vendors.find((v) => v.vendorNm && itemNm.includes(v.vendorNm)) ?? null;
}

// 출하이력(shipments)에서 item+hogi로 거래처를 정확 매칭. 가장 최근 출하건 1개의 BP_CD →
// vendors 마스터 JOIN으로 vendor_nm/tax_no를 얻는다. (호기→거래처의 가장 신뢰할 만한 경로)
async function lookupShipmentVendor(itemCode: string, hogi: number): Promise<VendorMatch | null> {
  const [row] = await db
    .select({ bpCd: shipmentsTable.bpCd })
    .from(shipmentsTable)
    .where(
      and(
        eq(shipmentsTable.itemCode, itemCode),
        eq(shipmentsTable.outHogiInt, hogi),
      ),
    )
    .orderBy(desc(shipmentsTable.realOutDt))
    .limit(1);
  if (!row?.bpCd) return null;
  const [vendor] = await db
    .select({
      vendorCd: vendorsTable.vendorCd,
      vendorNm: vendorsTable.vendorNm,
      taxNo: vendorsTable.taxNo,
    })
    .from(vendorsTable)
    .where(eq(vendorsTable.vendorCd, row.bpCd))
    .limit(1);
  // vendors 마스터에 없는 BP_CD라도 BP_CD 자체는 응답에 포함 (이름은 빈 값)
  return vendor ?? { vendorCd: row.bpCd, vendorNm: "", taxNo: null };
}

// 단일 item + 호기에 대해 거래처를 결정한다. 우선순위:
//   1) shipments 정확 매칭 (가장 신뢰)
//   2) product 검색에서 추론된 vendor (ITEM_NM 기반 폴백)
async function resolveVendor(
  item: ItemRow,
  hogi: number | null,
  vendorMatches: VendorMatch[],
): Promise<VendorMatch | null> {
  if (hogi != null) {
    const shipmentVendor = await lookupShipmentVendor(item.code, hogi);
    if (shipmentVendor) return shipmentVendor;
  }
  return pickVendorForItem(item, vendorMatches);
}

function buildResult(
  item: ItemRow,
  hogi: number | null,
  orders: (typeof productionOrdersTable.$inferSelect)[],
  vendor: VendorMatch | null = null,
) {
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
    vendorCd: vendor?.vendorCd ?? null,
    vendorNm: vendor?.vendorNm ?? null,
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

  if (!itemCode && !product && hogi == null) {
    res.status(400).json({ ok: false, reason: "itemCode/product/hogi 중 하나는 필요합니다." });
    return;
  }

  // 1) 품번 정확일치
  if (itemCode) {
    const [item] = await db.select().from(itemCodesTable).where(eq(itemCodesTable.code, itemCode)).limit(1);
    if (!item) {
      res.json({ ok: false, reason: "품목을 찾지 못함", candidates: [] });
      return;
    }
    const vendor = await resolveVendor(item, hogi, []);
    res.json(buildResult(item, hogi, await ordersFor(item.code, hogi), vendor));
    return;
  }

  // 2) 호기 단독 — 생산오더 + 출하이력 둘 다 조회 (출하된 호기도 잡힘)
  if (!product && hogi != null) {
    // 생산오더 호기 매칭
    const fromOrders = await db
      .selectDistinct({
        code: itemCodesTable.code,
        name: itemCodesTable.name,
        category: itemCodesTable.category,
        id: itemCodesTable.id,
        createdAt: itemCodesTable.createdAt,
      })
      .from(itemCodesTable)
      .innerJoin(productionOrdersTable, eq(productionOrdersTable.itemCode, itemCodesTable.code))
      .where(sql`${hogi} BETWEEN ${productionOrdersTable.hogiFrom} AND ${productionOrdersTable.hogiTo}`)
      .orderBy(asc(itemCodesTable.code));
    // 출하이력 호기 매칭 (숫자 호기만)
    const fromShipments = await db
      .selectDistinct({
        code: itemCodesTable.code,
        name: itemCodesTable.name,
        category: itemCodesTable.category,
        id: itemCodesTable.id,
        createdAt: itemCodesTable.createdAt,
      })
      .from(itemCodesTable)
      .innerJoin(shipmentsTable, eq(shipmentsTable.itemCode, itemCodesTable.code))
      .where(eq(shipmentsTable.outHogiInt, hogi))
      .orderBy(asc(itemCodesTable.code));
    // 합치고 중복 제거
    const merged = new Map<string, ItemRow>();
    for (const r of [...fromOrders, ...fromShipments]) merged.set(r.code, r as ItemRow);
    const rows = Array.from(merged.values());
    if (rows.length === 1) {
      const item = rows[0];
      const vendor = await resolveVendor(item, hogi, []);
      res.json(buildResult(item, hogi, await ordersFor(item.code, hogi), vendor));
      return;
    }
    res.json({
      ok: false,
      reason: rows.length ? `호기 ${hogi}에 ${rows.length}건 — 제품/품번을 함께 입력` : `호기 ${hogi} 매칭 없음`,
      candidates: rows,
    });
    return;
  }

  // 2) 제품명/품번/품목그룹/거래처 부분일치(한자↔영문 II/Ⅱ, vendors 마스터 통합)
  //    호기가 있으면 그 호기에 제조오더가 있는 품목으로 좁힘.
  const vendorMatches = await findVendors(product!);
  const vendorNames = vendorMatches.map((v) => v.vendorNm).filter((s): s is string => !!s);
  const matchCond = buildProductMatchCondition(product!, vendorNames);
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
          matchCond,
          sql`${hogi} BETWEEN ${productionOrdersTable.hogiFrom} AND ${productionOrdersTable.hogiTo}`,
        ),
      )
      .orderBy(asc(itemCodesTable.code));
    if (narrowed.length === 1) {
      const item = narrowed[0] as ItemRow;
      const vendor = await resolveVendor(item, hogi, vendorMatches);
      res.json(buildResult(item, hogi, await ordersFor(item.code, hogi), vendor));
      return;
    }
    if (narrowed.length > 1) {
      res.json({
        ok: false,
        reason: `품목 후보 ${narrowed.length}건 — 품번을 특정하세요`,
        candidates: narrowed,
        matchedVendors: vendorMatches,
      });
      return;
    }
    // 호기 매칭 없음 → 이름만 후보 안내로 폴백
  }

  const candidates = await db
    .select()
    .from(itemCodesTable)
    .where(matchCond)
    .orderBy(asc(itemCodesTable.code))
    .limit(25);

  if (candidates.length === 1) {
    const item = candidates[0];
    const vendor = await resolveVendor(item, hogi, vendorMatches);
    res.json(buildResult(item, hogi, await ordersFor(item.code, hogi), vendor));
    return;
  }
  res.json({
    ok: false,
    reason: candidates.length ? `품목 후보 ${candidates.length}건 — 호기 입력 또는 품번 특정` : "품목을 찾지 못함",
    candidates,
    matchedVendors: vendorMatches,
  });
});

export default router;

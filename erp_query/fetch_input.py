"""
제품(품번) + 출하호기 → NCR 부적합 보고서의 '나머지 입력 데이터'를 ERP에서 가져온다.
(읽기 전용)

NCR 제출 폼(submit.tsx)에서 작업자는 제품코드(itemCode)와 출하호기(shipmentUnit)만
입력하고, 아래 항목은 ERP에서 자동으로 채울 수 있다:
  - 제품명(modelName)   ← B_ITEM.ITEM_NM
  - 품목그룹(itemGroup) ← B_ITEM_GROUP.ITEM_GROUP_NM
  - 규격/품목분류/계정   ← B_ITEM.SPEC / ITEM_CLASS / ITEM_ACCT
  - 공장(factory)/plantCd ← 제조오더 P_PRODUCTION_ORDER_HEADER.PLANT_CD
  - 제조오더/생산일자/상태 ← P_PRODUCTION_ORDER_HEADER (품번 + 호기 범위 매칭)

사용 예:
    python fetch_input.py --item-cd T8NH-0000000-00 --hogi 365
    python fetch_input.py --product "T-380N" --hogi 365
    python fetch_input.py --item-cd T8NH-0000000-00 --hogi 365 --json
"""

import argparse
import json
import sys

from db import connect

# 공장(PLANT_CD) → NCR 폼 공장값 (submit.tsx FACTORY_OPTIONS 기준)
PLANT_TO_FACTORY = {"SA00": "아산", "SH00": "화성"}


def _row_to_dict(cur):
    cols = [d[0] for d in cur.description]
    row = cur.fetchone()
    return dict(zip(cols, row)) if row else None


def _rows_to_dicts(cur):
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


_ITEM_COLS = """i.ITEM_CD, i.ITEM_NM, i.SPEC, i.ITEM_GROUP_CD,
                g.ITEM_GROUP_NM, i.ITEM_CLASS, i.ITEM_ACCT"""


def resolve_item(cur, item_cd=None, product=None, hogi=None):
    """
    품목을 특정한다.
    - 품번(item_cd) 정확일치 우선
    - 제품명(product)만 주면 이름이 모호해 후보가 많음 → 호기로 좁힌다
    - 제품명 + 호기: 그 호기에 제조오더가 있는 품목만 → 보통 완성품 1건
    """
    if item_cd:
        cur.execute(
            f"""
            SELECT {_ITEM_COLS}
            FROM B_ITEM i
            LEFT JOIN B_ITEM_GROUP g ON g.ITEM_GROUP_CD = i.ITEM_GROUP_CD
            WHERE i.ITEM_CD = ?
            """,
            (item_cd,),
        )
        one = _row_to_dict(cur)
        return ([one] if one else []), bool(one)

    # 제품명 + 호기 → 호기에 제조오더가 있는 품목으로 좁힘 (핵심 disambiguation)
    if hogi is not None:
        cur.execute(
            f"""
            SELECT DISTINCT {_ITEM_COLS}
            FROM B_ITEM i
            JOIN P_PRODUCTION_ORDER_HEADER h ON h.ITEM_CD = i.ITEM_CD
            LEFT JOIN B_ITEM_GROUP g ON g.ITEM_GROUP_CD = i.ITEM_GROUP_CD
            WHERE (i.ITEM_CD LIKE ? OR i.ITEM_NM LIKE ?)
              AND TRY_CAST(? AS INT) BETWEEN
                  TRY_CAST(h.FROM_HOGI_KO368 AS INT) AND TRY_CAST(h.TO_HOGI_KO368 AS INT)
            ORDER BY i.ITEM_CD
            """,
            (f"%{product}%", f"%{product}%", str(hogi)),
        )
        rows = _rows_to_dicts(cur)
        if rows:
            return rows, (len(rows) == 1)
        # 호기 매칭이 없으면 이름만으로 폴백(후보 안내)

    # 제품명만 (또는 호기 매칭 실패) → 품번/품명 부분일치 후보
    cur.execute(
        f"""
        SELECT TOP 25 {_ITEM_COLS}
        FROM B_ITEM i
        LEFT JOIN B_ITEM_GROUP g ON g.ITEM_GROUP_CD = i.ITEM_GROUP_CD
        WHERE (i.ITEM_CD LIKE ? OR i.ITEM_NM LIKE ?) AND i.VALID_FLG <> 'N'
        ORDER BY i.ITEM_CD
        """,
        (f"%{product}%", f"%{product}%"),
    )
    return _rows_to_dicts(cur), False


def find_orders(cur, item_cd, hogi):
    """품번 + 호기에 매칭되는 제조오더 목록."""
    sql = """
        SELECT h.PRODT_ORDER_NO, h.PLANT_CD, h.ORDER_STATUS,
               h.PRODT_ORDER_QTY, h.FROM_HOGI_KO368, h.TO_HOGI_KO368,
               CONVERT(varchar(10), h.PLAN_START_DT, 23)  AS PLAN_START,
               CONVERT(varchar(10), h.PLAN_COMPT_DT, 23)  AS PLAN_COMPT,
               CONVERT(varchar(10), h.REAL_COMPT_DT, 23)  AS REAL_COMPT
        FROM P_PRODUCTION_ORDER_HEADER h
        WHERE h.ITEM_CD = ?
    """
    params = [item_cd]
    if hogi is not None:
        sql += (" AND TRY_CAST(? AS INT) BETWEEN TRY_CAST(h.FROM_HOGI_KO368 AS INT) "
                "AND TRY_CAST(h.TO_HOGI_KO368 AS INT)")
        params.append(str(hogi))
    sql += " ORDER BY TRY_CAST(h.FROM_HOGI_KO368 AS INT), h.PRODT_ORDER_NO"
    cur.execute(sql, params)
    return _rows_to_dicts(cur)


def fetch_input_data(item_cd=None, product=None, hogi=None):
    """제품+호기로 NCR 자동입력 데이터를 조립해 반환한다."""
    conn = connect(timeout=20)
    cur = conn.cursor()
    try:
        candidates, exact = resolve_item(cur, item_cd=item_cd, product=product, hogi=hogi)

        if not candidates:
            return {"ok": False, "reason": "품목을 찾지 못함", "candidates": []}

        # 후보가 여러 개면 선택 필요 (제품명만 주고 호기로도 안 좁혀진 경우)
        if not exact and len(candidates) != 1:
            hint = "호기를 함께 입력하거나 품번을 특정하세요" if product else "품번을 특정하세요"
            return {
                "ok": False,
                "reason": f"품목 후보 {len(candidates)}건 — {hint}",
                "candidates": candidates,
            }

        item = candidates[0]
        resolved_cd = item["ITEM_CD"]
        orders = find_orders(cur, resolved_cd, hogi)

        # 공장/plantCd 추론 (매칭된 오더 기준)
        plant_cd = orders[0]["PLANT_CD"] if orders else None
        factory = PLANT_TO_FACTORY.get(plant_cd) if plant_cd else None

        return {
            "ok": True,
            # NCR 폼 자동입력 필드
            "itemCode": resolved_cd,
            "modelName": item["ITEM_NM"],
            "itemGroupCd": item["ITEM_GROUP_CD"],
            "itemGroup": item["ITEM_GROUP_NM"],
            "spec": item["SPEC"],
            "itemClass": item["ITEM_CLASS"],
            "itemAcct": item["ITEM_ACCT"],
            "shipmentUnit": str(hogi) if hogi is not None else None,
            "plantCd": plant_cd,
            "factory": factory,
            # 참고용 제조오더 내역
            "matchedOrders": orders,
            "orderCount": len(orders),
        }
    finally:
        conn.close()


def _print_human(result):
    if not result["ok"]:
        print(f"⚠ {result['reason']}")
        for c in result.get("candidates", []):
            print(f"  - {c['ITEM_CD']}  {c['ITEM_NM']}  [그룹:{c.get('ITEM_GROUP_NM')}]")
        return

    print("=" * 60)
    print("NCR 자동입력 데이터")
    print("=" * 60)
    fields = [
        ("제품코드(itemCode)", result["itemCode"]),
        ("제품명(modelName)", result["modelName"]),
        ("품목그룹(itemGroup)", f"{result['itemGroup']} ({result['itemGroupCd']})"),
        ("규격(spec)", result["spec"]),
        ("품목분류(itemClass)", result["itemClass"]),
        ("출하호기(shipmentUnit)", result["shipmentUnit"]),
        ("공장(factory)", f"{result['factory']} / {result['plantCd']}"),
    ]
    for label, val in fields:
        print(f"  {label:24s}: {'' if val is None else val}")

    print(f"\n  매칭 제조오더: {result['orderCount']}건")
    for o in result["matchedOrders"]:
        print(f"   - {o['PRODT_ORDER_NO']:18s} 공장:{o['PLANT_CD']} "
              f"호기:{o['FROM_HOGI_KO368']}~{o['TO_HOGI_KO368']} "
              f"상태:{o['ORDER_STATUS']} 계획착수:{o['PLAN_START']}")


def main():
    ap = argparse.ArgumentParser(description="제품+출하호기 → NCR 자동입력 데이터 (읽기 전용)")
    ap.add_argument("--item-cd", help="품번 정확일치 (예: T8NH-0000000-00)")
    ap.add_argument("--product", help="품번/품명 부분일치 (예: T-380N)")
    ap.add_argument("--hogi", type=int, help="출하호기 번호 (예: 365)")
    ap.add_argument("--json", action="store_true", help="JSON으로 출력 (앱/API 연동용)")
    args = ap.parse_args()

    if not (args.item_cd or args.product):
        ap.error("--item-cd 또는 --product 중 하나는 필요합니다.")

    result = fetch_input_data(item_cd=args.item_cd, product=args.product, hogi=args.hogi)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    else:
        _print_human(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", type(e).__name__, e, file=sys.stderr)
        sys.exit(1)

"""
제품 + 호기로 제조오더를 조회한다. (읽기 전용)

ERP 메뉴 '생산관리 > 제조오더관리 > 제조오더 > 제조오더현황조회(S)' 에 대응하는
원천 테이블 P_PRODUCTION_ORDER_HEADER 를 직접 조회한다.

호기는 P_PRODUCTION_ORDER_HEADER.FROM_HOGI_KO368 ~ TO_HOGI_KO368 (호기 범위)에
정수형 문자열로 저장된다. 비교는 숫자로 수행한다.

사용 예:
    python find_order.py --product "T-380N" --hogi 365
    python find_order.py --item-cd T8NH-0000000-00 --hogi 365
    python find_order.py --product "T-380N"            # 호기 생략 시 전체 호기 목록
"""

import argparse
import sys

from db import connect


def find_orders(item_cd=None, product=None, hogi=None, plant=None, limit=200):
    where = []
    params = []

    if item_cd:
        where.append("h.ITEM_CD = ?")
        params.append(item_cd)
    if product:
        # 품번(ITEM_CD) 또는 품명(ITEM_NM) 부분일치
        where.append("(h.ITEM_CD LIKE ? OR i.ITEM_NM LIKE ?)")
        params.extend([f"%{product}%", f"%{product}%"])
    if plant:
        where.append("h.PLANT_CD = ?")
        params.append(plant)
    if hogi is not None:
        # 호기 범위 내 포함 (숫자 비교). 비숫자 호기는 TRY_CAST로 제외.
        where.append(
            "TRY_CAST(? AS INT) BETWEEN "
            "TRY_CAST(h.FROM_HOGI_KO368 AS INT) AND TRY_CAST(h.TO_HOGI_KO368 AS INT)"
        )
        params.append(str(hogi))
    else:
        # 호기 미지정이면 호기 있는 오더만
        where.append("h.FROM_HOGI_KO368 IS NOT NULL AND h.FROM_HOGI_KO368 <> ''")

    where_sql = " AND ".join(where) if where else "1=1"

    sql = f"""
        SELECT TOP {int(limit)}
            h.PRODT_ORDER_NO                          AS 제조오더,
            h.PLANT_CD                                AS 공장,
            h.ITEM_CD                                 AS 품번,
            i.ITEM_NM                                 AS 품명,
            i.SPEC                                    AS 규격,
            h.FROM_HOGI_KO368                         AS 시작호기,
            h.TO_HOGI_KO368                           AS 종료호기,
            h.PRODT_ORDER_QTY                         AS 오더수량,
            h.ORDER_STATUS                            AS 상태,
            h.CUSTOMER                                AS 고객,
            h.SO_NO                                   AS 수주번호,
            CONVERT(varchar(10), h.PLAN_START_DT, 23) AS 계획착수,
            CONVERT(varchar(10), h.REAL_COMPT_DT, 23) AS 실적완료
        FROM P_PRODUCTION_ORDER_HEADER h
        LEFT JOIN B_ITEM i ON i.ITEM_CD = h.ITEM_CD
        WHERE {where_sql}
        ORDER BY TRY_CAST(h.FROM_HOGI_KO368 AS INT), h.PRODT_ORDER_NO
    """

    conn = connect(timeout=20)
    cur = conn.cursor()
    cur.execute(sql, params)
    cols = [d[0] for d in cur.description]
    rows = [tuple(r) for r in cur.fetchall()]
    conn.close()
    return cols, rows


def print_table(cols, rows):
    if not rows:
        print("조회 결과 없음.")
        return
    widths = [len(c) for c in cols]
    str_rows = [["" if v is None else str(v) for v in r] for r in rows]
    for r in str_rows:
        for i, v in enumerate(r):
            widths[i] = max(widths[i], len(v))
    line = " | ".join(c.ljust(widths[i]) for i, c in enumerate(cols))
    print(line)
    print("-" * len(line))
    for r in str_rows:
        print(" | ".join(v.ljust(widths[i]) for i, v in enumerate(r)))
    print(f"\n총 {len(rows)}건")


def main():
    ap = argparse.ArgumentParser(description="제품+호기로 제조오더 조회 (읽기 전용)")
    ap.add_argument("--item-cd", help="품번 정확히 일치 (예: T8NH-0000000-00)")
    ap.add_argument("--product", help="품번/품명 부분일치 (예: T-380N)")
    ap.add_argument("--hogi", type=int, help="호기 번호 (예: 365)")
    ap.add_argument("--plant", help="공장 코드 (예: SA00)")
    ap.add_argument("--limit", type=int, default=200, help="최대 행수 (기본 200)")
    args = ap.parse_args()

    if not (args.item_cd or args.product):
        ap.error("--item-cd 또는 --product 중 하나는 필요합니다.")

    cols, rows = find_orders(
        item_cd=args.item_cd, product=args.product,
        hogi=args.hogi, plant=args.plant, limit=args.limit,
    )
    print_table(cols, rows)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", type(e).__name__, e, file=sys.stderr)
        sys.exit(1)

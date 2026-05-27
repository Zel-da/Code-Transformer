"""제조오더 헤더 + 품목 실제 데이터 샘플로 호기/품번/품명 형식 검증."""

import sys
from db import connect


def section(t):
    print("\n" + "=" * 70 + f"\n{t}\n" + "=" * 70)


def show(cur, sql, params=()):
    cur.execute(sql, params)
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    print(" | ".join(cols))
    print("-" * 70)
    for r in rows:
        print(" | ".join("" if v is None else str(v) for v in r))
    print(f"({len(rows)} rows)")
    return rows


def main():
    conn = connect(timeout=20)
    cur = conn.cursor()

    section("제조오더 건수 (전체 / 호기 입력된 것)")
    show(cur, "SELECT COUNT(*) AS 전체오더 FROM P_PRODUCTION_ORDER_HEADER")
    show(cur, "SELECT COUNT(*) AS 호기있는오더 FROM P_PRODUCTION_ORDER_HEADER "
              "WHERE FROM_HOGI_KO368 IS NOT NULL AND FROM_HOGI_KO368 <> ''")

    section("샘플: 호기가 입력된 최근 제조오더 (품명 조인)")
    show(cur, """
        SELECT TOP 15
            h.PRODT_ORDER_NO   AS 제조오더,
            h.PLANT_CD         AS 공장,
            h.ITEM_CD          AS 품번,
            i.ITEM_NM          AS 품명,
            h.FROM_HOGI_KO368  AS 시작호기,
            h.TO_HOGI_KO368    AS 종료호기,
            h.PRODT_ORDER_QTY  AS 오더수량,
            h.ORDER_STATUS     AS 상태,
            CONVERT(varchar(10), h.PLAN_START_DT, 23) AS 계획착수
        FROM P_PRODUCTION_ORDER_HEADER h
        LEFT JOIN B_ITEM i ON i.ITEM_CD = h.ITEM_CD
        WHERE h.FROM_HOGI_KO368 IS NOT NULL AND h.FROM_HOGI_KO368 <> ''
        ORDER BY h.INSRT_DT DESC
    """)

    section("호기 값 형식 분포 (길이/예시)")
    show(cur, """
        SELECT TOP 10 LEN(FROM_HOGI_KO368) AS 길이, COUNT(*) AS 건수,
               MIN(FROM_HOGI_KO368) AS 예시1, MAX(FROM_HOGI_KO368) AS 예시2
        FROM P_PRODUCTION_ORDER_HEADER
        WHERE FROM_HOGI_KO368 IS NOT NULL AND FROM_HOGI_KO368 <> ''
        GROUP BY LEN(FROM_HOGI_KO368)
        ORDER BY 건수 DESC
    """)

    conn.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", type(e).__name__, e, file=sys.stderr)
        sys.exit(1)

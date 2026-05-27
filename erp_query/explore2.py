"""제조오더 관련 테이블의 실제 컬럼 구조 + 호기/시리얼 보관 위치 탐색."""

import sys
from db import connect


def section(t):
    print("\n" + "=" * 70 + f"\n{t}\n" + "=" * 70)


def cols_of(cur, table):
    cur.execute(
        "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH "
        "FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
        (table,),
    )
    return cur.fetchall()


def main():
    conn = connect(timeout=15)
    cur = conn.cursor()

    for tbl in ("P_PRODUCTION_ORDER_HEADER", "P_PRODUCTION_ORDER_DETAIL",
                "P_PRODUCTION_RESULTS", "XQ_Model_Major_Serial_No"):
        section(f"컬럼: {tbl}")
        rows = cols_of(cur, tbl)
        if not rows:
            print("  (테이블 없음 또는 권한 없음)")
            continue
        for name, dt, ln in rows:
            print(f"  {name:38s} {dt}{('('+str(ln)+')') if ln else ''}")
        print(f"  -- 총 {len(rows)}컬럼")

    section("호기/시리얼 컬럼 탐색 (생산·모델 관련 테이블 한정)")
    cur.execute(
        r"""
        SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE (COLUMN_NAME LIKE '%SERIAL%' OR COLUMN_NAME LIKE '%SER_NO%'
               OR COLUMN_NAME LIKE '%HOGI%' OR COLUMN_NAME LIKE '%HO_GI%'
               OR COLUMN_NAME LIKE N'%호기%' OR COLUMN_NAME LIKE '%MACHINE_NO%'
               OR COLUMN_NAME LIKE '%UNIT_NO%' OR COLUMN_NAME LIKE '%BODY_NO%')
          AND (TABLE_NAME LIKE 'P\_%' ESCAPE '\' OR TABLE_NAME LIKE '%PRODUCTION%'
               OR TABLE_NAME LIKE 'MO[_]%' OR TABLE_NAME LIKE '%MODEL%'
               OR TABLE_NAME LIKE '%SERIAL%' OR TABLE_NAME LIKE 'B[_]ITEM%')
        ORDER BY TABLE_NAME, COLUMN_NAME
        """
    )
    for tn, cn, dt in cur.fetchall():
        print(f"  {tn}.{cn} ({dt})")

    section("품목 마스터 후보 (B_ITEM*) 와 핵심 컬럼")
    cur.execute(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
        "WHERE TABLE_NAME LIKE 'B[_]ITEM%' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME"
    )
    item_tbls = [r[0] for r in cur.fetchall()]
    print("  후보:", ", ".join(item_tbls) or "(없음)")
    for t in ("B_ITEM",):
        rows = cols_of(cur, t)
        if rows:
            section(f"컬럼: {t}")
            for name, dt, ln in rows[:40]:
                print(f"  {name:38s} {dt}{('('+str(ln)+')') if ln else ''}")
            print(f"  -- 총 {len(rows)}컬럼 (상위 40)")

    conn.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", type(e).__name__, e, file=sys.stderr)
        sys.exit(1)

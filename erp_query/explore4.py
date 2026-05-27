"""품목그룹(B_ITEM_GROUP) 구조 + B_ITEM 조인 검증."""
import sys
from db import connect


def section(t):
    print("\n" + "=" * 70 + f"\n{t}\n" + "=" * 70)


def show(cur, sql, params=()):
    cur.execute(sql, params)
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    print(" | ".join(cols))
    print("-" * 60)
    for r in rows:
        print(" | ".join("" if v is None else str(v) for v in r))
    print(f"({len(rows)} rows)")


def main():
    conn = connect(timeout=20)
    cur = conn.cursor()

    section("B_ITEM_GROUP 컬럼")
    cur.execute(
        "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH "
        "FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='B_ITEM_GROUP' ORDER BY ORDINAL_POSITION"
    )
    for n, dt, ln in cur.fetchall():
        print(f"  {n:30s} {dt}{('('+str(ln)+')') if ln else ''}")

    section("B_ITEM 품목분류(ITEM_CLASS) 관련 컬럼이 가리키는 마스터 후보")
    cur.execute(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
        "WHERE (TABLE_NAME LIKE '%ITEM_CLASS%' OR TABLE_NAME LIKE '%ITEM_GROUP%') "
        "AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME"
    )
    print("  ", ", ".join(r[0] for r in cur.fetchall()))

    section("샘플: T-380N 품목의 품명/품목그룹/분류")
    show(cur, """
        SELECT TOP 5
            i.ITEM_CD       AS 품번,
            i.ITEM_NM       AS 품명,
            i.SPEC          AS 규격,
            i.ITEM_GROUP_CD AS 품목그룹코드,
            g.ITEM_GROUP_NM AS 품목그룹명,
            i.ITEM_CLASS    AS 품목분류,
            i.ITEM_ACCT     AS 품목계정
        FROM B_ITEM i
        LEFT JOIN B_ITEM_GROUP g ON g.ITEM_GROUP_CD = i.ITEM_GROUP_CD
        WHERE i.ITEM_CD LIKE 'T8N%'
    """)

    conn.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", type(e).__name__, e, file=sys.stderr)
        sys.exit(1)

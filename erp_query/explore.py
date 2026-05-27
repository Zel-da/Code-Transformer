"""
ERP DB 스키마 탐색 — 제조오더/품번/품명/호기 관련 테이블·컬럼을 찾는다.
읽기 전용 SELECT만 수행.
"""

import sys

from db import connect


def section(title):
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


def run(cur, sql, params=()):
    cur.execute(sql, params)
    cols = [d[0] for d in cur.description] if cur.description else []
    rows = cur.fetchall()
    return cols, rows


def main():
    conn = connect(timeout=10)
    cur = conn.cursor()

    section("1. 연결/계정 확인")
    cols, rows = run(cur, "SELECT @@VERSION AS v")
    print(rows[0][0].splitlines()[0])
    cols, rows = run(cur, "SELECT DB_NAME() AS db, SUSER_SNAME() AS login, SYSTEM_USER AS sysuser")
    print("DB=%s  LOGIN=%s  USER=%s" % (rows[0][0], rows[0][1], rows[0][2]))

    section("2. 제조오더 추정 테이블/뷰 (이름 매칭)")
    like_patterns = [
        "%MO_HDR%", "%MO_DTL%", "%_MO%", "%WORK_ORDER%", "%WORKORDER%",
        "%_WO_%", "%PROD_ORD%", "%PRODUCTION%", "%MFG%", "%MANUF%",
        "%WKORD%", "%WORK_ODR%", "%PMO%", "%PWO%", "%JEJO%",
    ]
    where = " OR ".join(["TABLE_NAME LIKE ?"] * len(like_patterns))
    sql = (
        "SELECT TABLE_TYPE, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
        f"WHERE {where} ORDER BY TABLE_TYPE, TABLE_NAME"
    )
    cols, rows = run(cur, sql, like_patterns)
    if rows:
        for t, n in rows:
            print(f"  [{t[:4]}] {n}")
    else:
        print("  (이름 매칭 없음 — 다른 명명 규칙 사용 중일 수 있음)")
    print(f"  총 {len(rows)}건")

    section("3. '호기' 보관 컬럼 추정 (컬럼명 매칭)")
    col_patterns = ["%HOGI%", "%HO_GI%", "%MACHINE%", "%EQUIP%", "%SETBI%", "%_MC%", "%MC_%", "%LINE%"]
    where = " OR ".join(["COLUMN_NAME LIKE ?"] * len(col_patterns))
    sql = (
        "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
        f"WHERE ({where}) ORDER BY TABLE_NAME, COLUMN_NAME"
    )
    cols, rows = run(cur, sql, col_patterns)
    for tn, cn, dt in rows[:60]:
        print(f"  {tn}.{cn}  ({dt})")
    print(f"  총 {len(rows)}건 (상위 60 표시)")

    section("4. 품번/품명 보관 컬럼 추정 (컬럼명 매칭)")
    col_patterns = ["%ITEM_CD%", "%ITEM_NM%", "%GOODS_CD%", "%GOODS_NM%", "%PROD_CD%", "%PROD_NM%", "%PART%"]
    where = " OR ".join(["COLUMN_NAME LIKE ?"] * len(col_patterns))
    sql = (
        "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
        f"WHERE ({where}) ORDER BY TABLE_NAME, COLUMN_NAME"
    )
    cols, rows = run(cur, sql, col_patterns)
    for tn, cn, dt in rows[:40]:
        print(f"  {tn}.{cn}  ({dt})")
    print(f"  총 {len(rows)}건 (상위 40 표시)")

    conn.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", type(e).__name__, e, file=sys.stderr)
        sys.exit(1)

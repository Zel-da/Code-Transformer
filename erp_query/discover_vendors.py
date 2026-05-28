"""
ERP DB 거래처 마스터 테이블/컬럼 발견 스크립트.

UNIERP/SOOSANHI에서 거래처(매입처/매출처) 정보를 담는 테이블·컬럼을
INFORMATION_SCHEMA로 추적하여 후보 + 샘플 5건을 출력한다.
sync_vendors.py에 어떤 테이블·컬럼을 줄지 결정하기 위한 사전 조사용.

사용:
    python discover_vendors.py
"""

import sys

from db import connect


def section(title: str) -> None:
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


def run(cur, sql, params=()):
    cur.execute(sql, params)
    cols = [d[0] for d in cur.description] if cur.description else []
    rows = cur.fetchall()
    return cols, rows


def main() -> None:
    conn = connect(timeout=10)
    cur = conn.cursor()

    section("1. 연결/계정 확인")
    _, rows = run(cur, "SELECT @@VERSION AS v")
    print(rows[0][0].splitlines()[0])
    _, rows = run(
        cur,
        "SELECT DB_NAME() AS db, SUSER_SNAME() AS login, SYSTEM_USER AS sysuser",
    )
    print(f"DB={rows[0][0]}  LOGIN={rows[0][1]}  USER={rows[0][2]}")

    # ── 거래처 테이블 후보 ──
    section("2. 거래처 추정 테이블/뷰 (이름 매칭)")
    table_patterns = [
        "%BIZP%", "%BIZ_P%", "%BPARTNER%", "%PARTNER%",
        "%VENDOR%", "%CUSTOMER%", "%CUST%",
        "%SUPPLIER%", "%BIZCUST%", "%BIZNESS%",
        "%BUYER%", "%SELLER%",
    ]
    where = " OR ".join(["TABLE_NAME LIKE ?"] * len(table_patterns))
    sql = (
        "SELECT TABLE_TYPE, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
        f"WHERE {where} ORDER BY TABLE_TYPE, TABLE_NAME"
    )
    _, rows = run(cur, sql, table_patterns)
    candidate_tables = []
    if rows:
        for t, n in rows:
            print(f"  [{t[:4]}] {n}")
            if t == "BASE TABLE":
                candidate_tables.append(n)
    else:
        print("  (이름 매칭 없음 — 다른 명명 규칙 사용 중)")
    print(f"  총 {len(rows)}건 (BASE TABLE만 샘플 조회)")

    # ── 사업자번호 컬럼 후보 ──
    section("3. 사업자번호 보관 컬럼 추정 (10자리 코드)")
    col_patterns = [
        "%TAX_NO%", "%TAX_ID%", "%BUSINESS_NO%", "%BSN%",
        "%SAUP%", "%REG_NO%", "%CORP_NO%",
    ]
    where = " OR ".join(["COLUMN_NAME LIKE ?"] * len(col_patterns))
    sql = (
        "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
        f"WHERE ({where}) ORDER BY TABLE_NAME, COLUMN_NAME"
    )
    _, rows = run(cur, sql, col_patterns)
    for tn, cn, dt in rows[:60]:
        print(f"  {tn}.{cn}  ({dt})")
    print(f"  총 {len(rows)}건 (상위 60 표시)")

    # ── 거래처 코드/명 컬럼 후보 ──
    section("4. 거래처 코드/명 보관 컬럼 추정")
    col_patterns = [
        "%BIZP_CD%", "%BIZP_NM%", "%VENDOR_CD%", "%VENDOR_NM%",
        "%CUST_CD%", "%CUST_NM%", "%CUSTOMER_CD%", "%CUSTOMER_NM%",
        "%PARTNER_CD%", "%PARTNER_NM%", "%COMP_CD%", "%COMP_NM%",
    ]
    where = " OR ".join(["COLUMN_NAME LIKE ?"] * len(col_patterns))
    sql = (
        "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
        f"WHERE ({where}) ORDER BY TABLE_NAME, COLUMN_NAME"
    )
    _, rows = run(cur, sql, col_patterns)
    for tn, cn, dt in rows[:60]:
        print(f"  {tn}.{cn}  ({dt})")
    print(f"  총 {len(rows)}건 (상위 60 표시)")

    # ── 각 후보 테이블 샘플 5건 ──
    section("5. 후보 테이블별 컬럼 목록 + 샘플 5건")
    for tname in candidate_tables[:8]:
        print(f"\n--- {tname} ---")
        try:
            _, col_rows = run(
                cur,
                "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
                [tname],
            )
            print(f"  컬럼({len(col_rows)}개):", ", ".join(c[0] for c in col_rows[:25]))
            if len(col_rows) > 25:
                print(f"    ... +{len(col_rows) - 25} more")

            # 샘플 5건 (TOP 5)
            _, sample_rows = run(cur, f"SELECT TOP 5 * FROM {tname}")
            if sample_rows:
                print(f"  샘플(상위 5건):")
                for i, r in enumerate(sample_rows, 1):
                    preview = ", ".join(
                        f"{col_rows[j][0]}={str(v)[:30]!r}"
                        for j, v in enumerate(r[: min(8, len(col_rows))])
                    )
                    print(f"    [{i}] {preview}")
            else:
                print(f"  (행 없음)")
        except Exception as e:
            print(f"  ERROR: {e}")

    conn.close()
    print("\n" + "=" * 70)
    print("완료. 위 결과에서 거래처 테이블 이름과 (코드/명/사업자번호) 컬럼명을")
    print("선정해 sync_vendors.py 의 --table/--cd-col/--nm-col/--tax-col 인자로 주세요.")
    print("=" * 70)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", type(e).__name__, e, file=sys.stderr)
        sys.exit(1)

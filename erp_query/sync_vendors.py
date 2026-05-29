"""
ERP 거래처 마스터 → 앱 Postgres vendors 일일 동기화.

발견 스크립트(discover_vendors.py)로 확인한 테이블·컬럼 이름을 인자로 넘긴다.
sync_items.py와 동일한 패턴.

매핑:
  vendor_cd  = <table>.<cd-col>
  vendor_nm  = <table>.<nm-col>
  tax_no     = <table>.<tax-col>      (선택)
  valid_flg  = <table>.<valid-col>     (선택; 'Y'/'N'을 boolean으로)

DB 접속:
  - ERP(SQL Server): PRIVATE/erp_db.json  (db.py)
  - 앱(PostgreSQL):  환경변수 DATABASE_URL, 없으면 PRIVATE/app_db.json

사용 예:
  # 발견 후 (예: B_BIZP 테이블, BIZP_CD/BIZP_NM/TAX_NO/VALID_FLG 컬럼)
  python sync_vendors.py --table B_BIZP \
      --cd-col BIZP_CD --nm-col BIZP_NM \
      --tax-col TAX_NO --valid-col VALID_FLG --dry-run

  # 운영
  python sync_vendors.py --table B_BIZP \
      --cd-col BIZP_CD --nm-col BIZP_NM \
      --tax-col TAX_NO --valid-col VALID_FLG
"""

import argparse
import json
import os
import sys

import psycopg2
from psycopg2.extras import execute_values

import db as erp_db

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if url:
        return url
    path = os.path.join(_BASE, "PRIVATE", "app_db.json")
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f).get("database_url", "")
    return ""


def fetch_vendors(table: str, cd_col: str, nm_col: str,
                  tax_col: str | None, valid_col: str | None,
                  limit: int | None) -> list[tuple]:
    """ERP에서 (vendor_cd, vendor_nm, tax_no, valid_flg) 목록을 가져온다."""
    select_parts = [f"{cd_col}", f"{nm_col}"]
    select_parts.append(f"{tax_col}" if tax_col else "NULL")
    select_parts.append(f"{valid_col}" if valid_col else "'Y'")
    top = f"TOP {int(limit)}" if limit else ""
    sql = f"SELECT {top} {', '.join(select_parts)} FROM {table}"

    conn = erp_db.connect(timeout=60)
    cur = conn.cursor()
    cur.execute(sql)
    rows = []
    for cd, nm, tax, valid in cur.fetchall():
        cd_s = str(cd).strip() if cd is not None else ""
        if not cd_s:
            continue
        nm_s = (nm or "").strip()
        tax_s = (str(tax).strip() if tax is not None else "") or None
        # VALID_FLG: 'Y'/'1'/True → True, 그 외 → False
        valid_v = str(valid).strip().upper() if valid is not None else "Y"
        valid_b = valid_v in ("Y", "1", "TRUE", "T")
        rows.append((cd_s, nm_s, tax_s, valid_b))
    conn.close()

    # 중복 vendor_cd 제거 (마지막 값 우선)
    dedup: dict[str, tuple] = {r[0]: r for r in rows}
    return list(dedup.values())


def upsert_vendors(rows: list[tuple]) -> int:
    url = _database_url()
    if not url:
        raise SystemExit(
            "DATABASE_URL 미설정 — 환경변수 또는 PRIVATE/app_db.json 에 앱 Postgres 접속정보를 넣으세요."
        )
    conn = psycopg2.connect(url)
    try:
        with conn, conn.cursor() as cur:
            execute_values(
                cur,
                """
                INSERT INTO vendors (vendor_cd, vendor_nm, tax_no, valid_flg)
                VALUES %s
                ON CONFLICT (vendor_cd) DO UPDATE
                  SET vendor_nm = EXCLUDED.vendor_nm,
                      tax_no    = EXCLUDED.tax_no,
                      valid_flg = EXCLUDED.valid_flg,
                      synced_at = now()
                """,
                rows,
                page_size=1000,
            )
        return len(rows)
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="ERP 거래처 → 앱 vendors 동기화")
    ap.add_argument("--table", required=True, help="거래처 마스터 테이블명 (예: B_BIZP)")
    ap.add_argument("--cd-col", required=True, help="거래처 코드 컬럼 (예: BIZP_CD)")
    ap.add_argument("--nm-col", required=True, help="거래처 명 컬럼 (예: BIZP_NM)")
    ap.add_argument("--tax-col", default=None, help="사업자번호 컬럼 (선택)")
    ap.add_argument("--valid-col", default=None, help="유효 플래그 컬럼 (선택)")
    ap.add_argument("--limit", type=int, default=None, help="상위 N건만 (테스트)")
    ap.add_argument("--dry-run", action="store_true", help="ERP만 읽고 PG에 쓰지 않음")
    args = ap.parse_args()

    print(f"[sync] ERP 거래처 조회: {args.table} (cd={args.cd_col}, nm={args.nm_col}, "
          f"tax={args.tax_col}, valid={args.valid_col}, limit={args.limit})")
    rows = fetch_vendors(
        args.table, args.cd_col, args.nm_col,
        args.tax_col, args.valid_col, args.limit,
    )
    print(f"[sync] 대상 {len(rows):,}건")
    for r in rows[:5]:
        print(f"   - cd={r[0]}  nm={r[1][:30]}  tax={r[2]}  valid={r[3]}")

    if args.dry_run:
        print("[sync] --dry-run: PG 미반영")
        return

    n = upsert_vendors(rows)
    print(f"[sync] vendors upsert 완료: {n:,}건")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", type(e).__name__, e, file=sys.stderr)
        sys.exit(1)

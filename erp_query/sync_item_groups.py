"""
ERP 품목그룹 마스터 (B_ITEM_GROUP) → 앱 Postgres item_groups 일일 동기화.

UNIERP 부적합등록 폼의 "품목그룹" 칸에 입력하는 코드(예: CL411)와
이름(예: SDQ02P)을 동기화. RPA가 보고서의 item_codes.category
(=group_nm)를 코드로 변환할 때 사용.

매핑:
  group_cd = B_ITEM_GROUP.ITEM_GROUP_CD
  group_nm = B_ITEM_GROUP.ITEM_GROUP_NM
  valid_flg = B_ITEM_GROUP.VALID_FLG ('Y'면 True)

DB 접속:
  - ERP(SQL Server): PRIVATE/erp_db.json  (db.py)
  - 앱(PostgreSQL):  환경변수 DATABASE_URL, 없으면 PRIVATE/app_db.json

사용:
  python sync_item_groups.py --dry-run    # ERP만 읽고 건수/샘플 출력
  python sync_item_groups.py              # 전체 upsert
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


def fetch_groups():
    """ERP B_ITEM_GROUP에서 (group_cd, group_nm, valid_flg) 가져오기."""
    sql = """
        SELECT ITEM_GROUP_CD, ITEM_GROUP_NM,
               COALESCE(VALID_FLG, 'Y') AS VALID_FLG
        FROM B_ITEM_GROUP
    """
    conn = erp_db.connect(timeout=60)
    cur = conn.cursor()
    cur.execute(sql)
    rows = []
    for cd, nm, valid in cur.fetchall():
        cd_s = str(cd).strip() if cd is not None else ""
        nm_s = str(nm).strip() if nm is not None else ""
        if not cd_s or not nm_s:
            continue
        valid_v = str(valid).strip().upper() if valid is not None else "Y"
        valid_b = valid_v in ("Y", "1", "TRUE", "T")
        rows.append((cd_s, nm_s, valid_b))
    conn.close()
    # 중복 group_cd 제거 (마지막 값 우선)
    dedup = {r[0]: r for r in rows}
    return list(dedup.values())


def upsert_groups(rows) -> int:
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
                INSERT INTO item_groups (group_cd, group_nm, valid_flg)
                VALUES %s
                ON CONFLICT (group_cd) DO UPDATE
                  SET group_nm  = EXCLUDED.group_nm,
                      valid_flg = EXCLUDED.valid_flg,
                      synced_at = NOW()
                """,
                rows,
                page_size=1000,
            )
        return len(rows)
    finally:
        conn.close()


def main():
    ap = argparse.ArgumentParser(description="ERP 품목그룹 → 앱 item_groups 동기화")
    ap.add_argument("--dry-run", action="store_true", help="ERP만 읽고 PG에 쓰지 않음")
    args = ap.parse_args()

    print("[sync] ERP B_ITEM_GROUP 조회 중...")
    rows = fetch_groups()
    print(f"[sync] 대상 {len(rows):,}건")
    for r in rows[:5]:
        print(f"   - cd={r[0]:<8} nm={r[1][:30]:<30} valid={r[2]}")

    if args.dry_run:
        print("[sync] --dry-run: PG 미반영")
        return

    n = upsert_groups(rows)
    print(f"[sync] item_groups upsert 완료: {n:,}건")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", type(e).__name__, e, file=sys.stderr)
        sys.exit(1)

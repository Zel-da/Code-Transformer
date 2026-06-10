"""
ERP 품목 마스터(B_ITEM) → 앱 Postgres item_codes 일일 동기화.

매핑:
  code     = B_ITEM.ITEM_CD
  name     = B_ITEM.ITEM_NM
  category = B_ITEM_GROUP.ITEM_GROUP_NM  (ITEM_GROUP_CD 조인)

대상 범위(--scope):
  all       유효(VALID_FLG<>'N') 전체 품목            (기본, ~16.8만건)
  produced  제조오더가 존재하는 품목만 (실제 생산/출하)
  group:NM  특정 품목그룹명만 (예: group:SDQ02P)

DB 접속:
  - ERP(SQL Server): PRIVATE/erp_db.json  (db.py)
  - 앱(PostgreSQL):  환경변수 DATABASE_URL, 없으면 PRIVATE/app_db.json {"database_url": "..."}

사용:
  python sync_items.py --dry-run            # ERP만 읽고 건수/샘플 출력 (PG 미접속)
  python sync_items.py --scope produced     # 생산 품목만 upsert
  python sync_items.py                       # 전체 upsert
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


def fetch_items(scope: str):
    """ERP에서 (code, name, category) 목록을 가져온다."""
    from filters import FINISHED_GOOD_WHERE
    # 완성품 필터 (브레이커/부품/공통그룹 제외) — 모든 scope에 공통 적용
    where = [f"({FINISHED_GOOD_WHERE})"]
    params: list = []

    if scope == "produced":
        where.append(
            "EXISTS (SELECT 1 FROM P_PRODUCTION_ORDER_HEADER h WHERE h.ITEM_CD = i.ITEM_CD)"
        )
    elif scope.startswith("group:"):
        where.append("g.ITEM_GROUP_NM = ?")
        params.append(scope.split(":", 1)[1])
    elif scope != "all":
        raise SystemExit(f"알 수 없는 scope: {scope}")

    sql = f"""
        SELECT i.ITEM_CD, i.ITEM_NM, COALESCE(g.ITEM_GROUP_NM, '') AS CATEGORY
        FROM B_ITEM i
        LEFT JOIN B_ITEM_GROUP g ON g.ITEM_GROUP_CD = i.ITEM_GROUP_CD
        WHERE {' AND '.join(where)}
    """
    conn = erp_db.connect(timeout=60)
    cur = conn.cursor()
    cur.execute(sql, params)
    rows = [
        (str(c).strip(), (n or "").strip(), (cat or "").strip())
        for c, n, cat in cur.fetchall()
        if c and str(c).strip()
    ]
    conn.close()
    # 중복 코드 제거 (마지막 값 우선)
    dedup = {r[0]: r for r in rows}
    return list(dedup.values())


def upsert_items(rows) -> int:
    """TRUNCATE + bulk INSERT (트랜잭션). 필터에서 제외된 옛 행도 자연 삭제."""
    url = _database_url()
    if not url:
        raise SystemExit(
            "DATABASE_URL 미설정 — 환경변수 또는 PRIVATE/app_db.json 에 앱 Postgres 접속정보를 넣으세요."
        )
    conn = psycopg2.connect(url)
    try:
        with conn, conn.cursor() as cur:
            cur.execute("TRUNCATE TABLE item_codes RESTART IDENTITY")
            if rows:
                execute_values(
                    cur,
                    "INSERT INTO item_codes (code, name, category) VALUES %s",
                    rows,
                    page_size=1000,
                )
        return len(rows)
    finally:
        conn.close()


def main():
    ap = argparse.ArgumentParser(description="ERP 품목 → 앱 item_codes 동기화")
    ap.add_argument("--scope", default="all",
                    help="all | produced | group:<그룹명> (기본 all)")
    ap.add_argument("--dry-run", action="store_true", help="ERP만 읽고 PG에 쓰지 않음")
    args = ap.parse_args()

    print(f"[sync] ERP 품목 조회 중 (scope={args.scope})...")
    rows = fetch_items(args.scope)
    print(f"[sync] 대상 {len(rows):,}건")
    for r in rows[:5]:
        print(f"   - {r[0]}  {r[1][:40]}  [{r[2]}]")

    if args.dry_run:
        print("[sync] --dry-run: PG 미반영")
        return

    n = upsert_items(rows)
    print(f"[sync] item_codes upsert 완료: {n:,}건")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", type(e).__name__, e, file=sys.stderr)
        sys.exit(1)

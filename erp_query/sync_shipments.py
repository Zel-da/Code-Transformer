"""
ERP 출하 이력(XW_DELIVERY_CAR_INFO) → 앱 Postgres shipments 일일 동기화.

출하호기 → 거래처(BP_CD) 정확 매칭의 핵심 데이터.
production_orders가 '생산 진행 호기' 미러라면, 여기는 '이미 출하된 호기' 미러.

매핑(XW_DELIVERY_CAR_INFO):
  item_code     = ITEM_CD
  out_hogi      = OUT_HOGI                       (텍스트, 예: '345' 또는 'WA-91381')
  out_hogi_int  = TRY_CAST(OUT_HOGI AS INT)      (숫자 매칭용)
  bp_cd         = BP_CD                          (vendors.vendor_cd JOIN)
  real_out_dt   = REAL_OUT_DT
  vehicle_no    = VEHICLE_NO

동기화 전략: TRUNCATE + bulk INSERT (트랜잭션). 출하 취소/수정도 자연 반영.

사용:
  python sync_shipments.py --dry-run
  python sync_shipments.py
"""

import argparse
import sys

import psycopg2
from psycopg2.extras import execute_values

import db as erp_db
from sync_items import _database_url


def fetch_shipments() -> list[tuple]:
    sql = """
        SELECT ITEM_CD, OUT_HOGI,
               TRY_CAST(OUT_HOGI AS INT) AS OUT_HOGI_INT,
               BP_CD, REAL_OUT_DT, VEHICLE_NO
        FROM XW_DELIVERY_CAR_INFO
        WHERE OUT_HOGI IS NOT NULL AND OUT_HOGI <> ''
          AND ITEM_CD  IS NOT NULL AND ITEM_CD  <> ''
    """
    conn = erp_db.connect(timeout=60)
    cur = conn.cursor()
    cur.execute(sql)
    rows = []
    for ic, oh, ohi, bp, rod, vno in cur.fetchall():
        ic_s = (ic or "").strip()
        oh_s = (oh or "").strip()
        if not ic_s or not oh_s:
            continue
        rows.append((
            ic_s,
            oh_s,
            int(ohi) if ohi is not None else None,
            (bp or "").strip() or None,
            rod,                                 # datetime or None
            (vno or "").strip() or None,
        ))
    conn.close()
    return rows


def replace_all(rows: list[tuple]) -> int:
    """TRUNCATE + bulk INSERT in a single transaction. 실패 시 롤백되어 기존 데이터 유지."""
    url = _database_url()
    if not url:
        raise SystemExit("DATABASE_URL 미설정 — PRIVATE/app_db.json 또는 환경변수.")
    conn = psycopg2.connect(url)
    try:
        with conn, conn.cursor() as cur:
            cur.execute("TRUNCATE TABLE shipments RESTART IDENTITY")
            if rows:
                execute_values(
                    cur,
                    """
                    INSERT INTO shipments
                      (item_code, out_hogi, out_hogi_int, bp_cd, real_out_dt, vehicle_no)
                    VALUES %s
                    """,
                    rows,
                    page_size=2000,
                )
        return len(rows)
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="ERP 출하이력 → 앱 shipments 동기화")
    ap.add_argument("--dry-run", action="store_true", help="ERP만 읽고 PG에 쓰지 않음")
    args = ap.parse_args()

    print("[sync_shipments] ERP 출하이력 조회 중...")
    rows = fetch_shipments()
    print(f"[sync_shipments] 대상 {len(rows):,}건")
    for r in rows[:5]:
        print(f"   - item={r[0]:18s} out_hogi={r[1]:>10s} ({r[2]})  bp={r[3]}  date={r[4]}")

    if args.dry_run:
        print("[sync_shipments] --dry-run: PG 미반영")
        return

    n = replace_all(rows)
    print(f"[sync_shipments] TRUNCATE+INSERT 완료: {n:,}건")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", type(e).__name__, e, file=sys.stderr)
        sys.exit(1)

"""
ERP 제조오더(호기 보유분) → 앱 Postgres production_orders 동기화.
출하호기 → 제품/공장 자동조회의 클라우드(Neon) 측 소스.

매핑(P_PRODUCTION_ORDER_HEADER):
  prodt_order_no = PRODT_ORDER_NO
  item_code      = ITEM_CD
  plant_cd       = PLANT_CD
  hogi_from/to   = TRY_CAST(FROM/TO_HOGI_KO368 AS INT)   (숫자 호기만)
  order_status   = ORDER_STATUS
  plan_start     = PLAN_START_DT (YYYY-MM-DD)

사용:
  python sync_orders.py --dry-run
  python sync_orders.py
"""

import argparse
import sys

import psycopg2
from psycopg2.extras import execute_values

import db as erp_db
from sync_items import _database_url


def fetch_orders():
    from filters import FINISHED_GOOD_WHERE
    # 완성품 필터: B_ITEM/B_ITEM_GROUP JOIN해서 브레이커/부품 제외
    sql = f"""
        SELECT h.PRODT_ORDER_NO, h.ITEM_CD, h.PLANT_CD,
               TRY_CAST(h.FROM_HOGI_KO368 AS INT) AS HF,
               TRY_CAST(h.TO_HOGI_KO368   AS INT) AS HT,
               h.ORDER_STATUS,
               CONVERT(varchar(10), h.PLAN_START_DT, 23) AS PS
        FROM P_PRODUCTION_ORDER_HEADER h
        JOIN B_ITEM i ON i.ITEM_CD = h.ITEM_CD
        LEFT JOIN B_ITEM_GROUP g ON g.ITEM_GROUP_CD = i.ITEM_GROUP_CD
        WHERE h.FROM_HOGI_KO368 IS NOT NULL AND h.FROM_HOGI_KO368 <> ''
          AND TRY_CAST(h.FROM_HOGI_KO368 AS INT) IS NOT NULL
          AND ({FINISHED_GOOD_WHERE})
    """
    conn = erp_db.connect(timeout=60)
    cur = conn.cursor()
    cur.execute(sql)
    rows = []
    for ono, item, plant, hf, ht, status, ps in cur.fetchall():
        if not ono:
            continue
        rows.append((
            str(ono).strip(),
            (item or "").strip(),
            (plant or "").strip() or None,
            int(hf),
            int(ht) if ht is not None else int(hf),  # TO 없으면 단일 호기
            (status or "").strip() or None,
            ps,  # 'YYYY-MM-DD' or None
        ))
    conn.close()
    # 중복 오더번호 제거
    return list({r[0]: r for r in rows}.values())


def upsert(rows) -> int:
    """TRUNCATE + bulk INSERT (트랜잭션). 필터에서 제외된 옛 행도 자연 삭제."""
    url = _database_url()
    if not url:
        raise SystemExit("DATABASE_URL 미설정 — PRIVATE/app_db.json 또는 환경변수.")
    conn = psycopg2.connect(url)
    try:
        with conn, conn.cursor() as cur:
            cur.execute("TRUNCATE TABLE production_orders")
            if rows:
                execute_values(
                    cur,
                    """
                    INSERT INTO production_orders
                      (prodt_order_no, item_code, plant_cd, hogi_from, hogi_to, order_status, plan_start)
                    VALUES %s
                    """,
                    rows,
                    page_size=1000,
                )
        return len(rows)
    finally:
        conn.close()


def main():
    ap = argparse.ArgumentParser(description="ERP 제조오더(호기) → 앱 production_orders 동기화")
    ap.add_argument("--dry-run", action="store_true", help="ERP만 읽고 PG에 쓰지 않음")
    args = ap.parse_args()

    print("[sync_orders] ERP 제조오더(호기) 조회 중...")
    rows = fetch_orders()
    print(f"[sync_orders] 대상 {len(rows):,}건")
    for r in rows[:5]:
        print(f"   - {r[0]:18s} {r[1]:18s} plant={r[2]} 호기={r[3]}~{r[4]} {r[5]}")

    if args.dry_run:
        print("[sync_orders] --dry-run: PG 미반영")
        return

    n = upsert(rows)
    print(f"[sync_orders] production_orders upsert 완료: {n:,}건")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", type(e).__name__, e, file=sys.stderr)
        sys.exit(1)

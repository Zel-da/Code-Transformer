"""
K-System Q_FLAW_CKO063 (UNIERP 부적합판정등록) → Neon erp_defect_history.

용도:
  - 과거 부적합 데이터 전체 1회 백필 (--full)
  - 매일 증분 (--incremental, 기본): Neon 의 MAX(insrt_date) 이후만

Q_FLAW_CKO063 50컬럼을 raw_payload JSONB 에 통째로 보존 + 핵심 48컬럼 매핑.
공장 구분: PLANT_CD (SA00 아산, SH00 화성).
부적합 구분: FLAW_GBN (QC=공정, QO=출하, AS, QI, QA).

사용:
    python sync_defect_history.py --full           # 전체 백필 (TRUNCATE 안 함, UPSERT)
    python sync_defect_history.py --incremental    # 증분 (기본)
    python sync_defect_history.py --since 2026-01-01   # 특정 날짜 이후
    python sync_defect_history.py --dry-run        # ERP 조회만, Neon 미반영
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys

import psycopg2
from psycopg2.extras import Json, execute_values

import db as erp_db
from sync_items import _database_url


# Q_FLAW_CKO063 전체 컬럼 (K-System 기준, SELECT 순서)
_SRC_COLS = (
    "REPORT_NO", "STATUS_FLAG", "DEPT_CD", "DEPT_NM", "FLAW_GBN",
    "REPAIR_NO", "REPORT_DT", "INPUT_DT", "PLANT_CD", "PROCESS_CD",
    "ITEM_CD", "ITEM_GROUP_CD", "FLAW_QTY", "TYPE_CD", "LOSS_MH",
    "BP_CD", "PAR_ITEM_CD", "OUT_HOGI", "ISSUE_DT", "REMARK",
    "INIT_QA_YN", "REL_DEPT_YN", "REL_DEPT_CD", "CLAIM_YN", "PART_COST",
    "LABOR_COST", "CLAIM_AMT", "FINAL_CLAIM_AMT", "DECIDE_RESULT", "FLAW_STATE",
    "ACT_RESULT", "REL_DEPT_DT", "REL_DEPT_COMMENT", "REL_DEPT_USER_ID", "CAP_YN",
    "CAP_ACTION", "QA_COMMENT", "DECIDE_YN", "DECIDE_DT", "SIGN_YN",
    "SIGN_DT", "FINAL_YN", "FINAL_DT", "INSRT_USER_ID", "INSRT_DT",
    "UPDT_USER_ID", "UPDT_DT", "REG_DT", "BIZ_DT", "USE_ITEM_SEQ",
)

# 대상 Neon 컬럼 (snake_case, erp_defect_history 스키마 순서와 일치)
_DST_COLS = (
    "erp_report_no", "status_flag", "dept_cd", "dept_nm", "flaw_gbn",
    "repair_no", "report_date", "input_date", "plant_cd", "process_cd",
    "item_code", "item_group_cd", "flaw_qty", "type_cd", "loss_mh",
    "vendor_cd", "par_item_code", "out_hogi", "issue_date", "remark",
    "init_qa_yn", "rel_dept_yn", "rel_dept_cd", "claim_yn", "part_cost",
    "labor_cost", "claim_amt", "final_claim_amt", "decide_result", "flaw_state",
    "act_result", "rel_dept_date", "rel_dept_comment", "rel_dept_user_id", "cap_yn",
    "cap_action", "qa_comment", "decide_yn", "decide_date", "sign_yn",
    "sign_date", "final_yn", "final_date", "insrt_user_id", "insrt_date",
    "updt_user_id", "updt_date", "reg_date", "biz_date", "use_item_seq",
    "raw_payload",
)


def _clean(v):
    """nvarchar 공백 trim, 빈 문자열 → None. datetime·numeric 은 그대로."""
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip()
        return s if s else None
    return v


def fetch_from_kystem(since: dt.datetime | None) -> list[tuple]:
    """Q_FLAW_CKO063 전체 또는 since 이후 레코드 조회."""
    sql = f"SELECT {', '.join(_SRC_COLS)} FROM Q_FLAW_CKO063"
    params: list = []
    if since is not None:
        sql += " WHERE INSRT_DT > ?"
        params.append(since)
    sql += " ORDER BY INSRT_DT ASC"

    conn = erp_db.connect(timeout=120)
    cur = conn.cursor()
    cur.execute(sql, params)
    rows = cur.fetchall()
    conn.close()
    return rows


def _row_to_dst(row: tuple) -> tuple:
    """K-System row → Neon INSERT 튜플.
    _DST_COLS 순서에 맞춰 각 값 정리. 마지막 raw_payload 는 JSONB (dict → psycopg2 Json)."""
    cleaned = [_clean(v) for v in row]
    # raw_payload: 원본 50컬럼을 dict 로 보존 (TIMESTAMP 는 isoformat)
    raw = {}
    for name, val in zip(_SRC_COLS, row):
        if isinstance(val, dt.datetime):
            raw[name] = val.isoformat()
        elif val is None:
            raw[name] = None
        else:
            raw[name] = str(val) if not isinstance(val, (int, float, bool)) else val

    # 매핑 (K-System 순서 → Neon 순서 교차 조정)
    m = dict(zip(_SRC_COLS, cleaned))
    # _DST_COLS 순서로 재배열. vendor_cd ← BP_CD, par_item_code ← PAR_ITEM_CD 등.
    dst = (
        m["REPORT_NO"], m["STATUS_FLAG"], m["DEPT_CD"], m["DEPT_NM"], m["FLAW_GBN"],
        m["REPAIR_NO"], m["REPORT_DT"], m["INPUT_DT"], m["PLANT_CD"], m["PROCESS_CD"],
        m["ITEM_CD"], m["ITEM_GROUP_CD"], m["FLAW_QTY"], m["TYPE_CD"], m["LOSS_MH"],
        m["BP_CD"], m["PAR_ITEM_CD"], m["OUT_HOGI"], m["ISSUE_DT"], m["REMARK"],
        m["INIT_QA_YN"], m["REL_DEPT_YN"], m["REL_DEPT_CD"], m["CLAIM_YN"], m["PART_COST"],
        m["LABOR_COST"], m["CLAIM_AMT"], m["FINAL_CLAIM_AMT"], m["DECIDE_RESULT"], m["FLAW_STATE"],
        m["ACT_RESULT"], m["REL_DEPT_DT"], m["REL_DEPT_COMMENT"], m["REL_DEPT_USER_ID"], m["CAP_YN"],
        m["CAP_ACTION"], m["QA_COMMENT"], m["DECIDE_YN"], m["DECIDE_DT"], m["SIGN_YN"],
        m["SIGN_DT"], m["FINAL_YN"], m["FINAL_DT"], m["INSRT_USER_ID"], m["INSRT_DT"],
        m["UPDT_USER_ID"], m["UPDT_DT"], m["REG_DT"], m["BIZ_DT"], m["USE_ITEM_SEQ"],
        Json(raw),
    )
    return dst


_UPSERT_SQL = f"""
INSERT INTO erp_defect_history ({', '.join(_DST_COLS)})
VALUES %s
ON CONFLICT (erp_report_no) DO UPDATE SET
  status_flag = EXCLUDED.status_flag,
  dept_cd = EXCLUDED.dept_cd,
  dept_nm = EXCLUDED.dept_nm,
  flaw_gbn = EXCLUDED.flaw_gbn,
  report_date = EXCLUDED.report_date,
  input_date = EXCLUDED.input_date,
  plant_cd = EXCLUDED.plant_cd,
  process_cd = EXCLUDED.process_cd,
  item_code = EXCLUDED.item_code,
  item_group_cd = EXCLUDED.item_group_cd,
  flaw_qty = EXCLUDED.flaw_qty,
  type_cd = EXCLUDED.type_cd,
  loss_mh = EXCLUDED.loss_mh,
  vendor_cd = EXCLUDED.vendor_cd,
  flaw_state = EXCLUDED.flaw_state,
  act_result = EXCLUDED.act_result,
  cap_yn = EXCLUDED.cap_yn,
  cap_action = EXCLUDED.cap_action,
  decide_result = EXCLUDED.decide_result,
  qa_comment = EXCLUDED.qa_comment,
  claim_yn = EXCLUDED.claim_yn,
  part_cost = EXCLUDED.part_cost,
  labor_cost = EXCLUDED.labor_cost,
  claim_amt = EXCLUDED.claim_amt,
  final_claim_amt = EXCLUDED.final_claim_amt,
  updt_user_id = EXCLUDED.updt_user_id,
  updt_date = EXCLUDED.updt_date,
  raw_payload = EXCLUDED.raw_payload,
  synced_at = now()
"""


def upsert_to_neon(rows: list[tuple]) -> int:
    url = _database_url()
    if not url:
        raise SystemExit("DATABASE_URL 미설정 — PRIVATE/app_db.json 또는 env.")
    conn = psycopg2.connect(url)
    try:
        with conn, conn.cursor() as cur:
            if rows:
                execute_values(cur, _UPSERT_SQL, rows, page_size=500)
        return len(rows)
    finally:
        conn.close()


def get_max_insrt_date() -> dt.datetime | None:
    url = _database_url()
    conn = psycopg2.connect(url)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT MAX(insrt_date) FROM erp_defect_history")
            r = cur.fetchone()
        return r[0] if r and r[0] else None
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="K-System Q_FLAW_CKO063 → Neon erp_defect_history")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--full", action="store_true", help="전체 백필 (UPSERT, 기존 데이터 유지)")
    mode.add_argument("--incremental", action="store_true", help="증분(기본): Neon 의 MAX(insrt_date) 이후")
    mode.add_argument("--since", type=str, help="YYYY-MM-DD 이후만")
    ap.add_argument("--dry-run", action="store_true", help="ERP 조회만, Neon 미반영")
    args = ap.parse_args()

    # 모드 결정
    since: dt.datetime | None = None
    if args.full:
        mode_label = "full"
    elif args.since:
        since = dt.datetime.strptime(args.since, "%Y-%m-%d")
        mode_label = f"since {args.since}"
    else:
        # 기본: incremental
        mx = get_max_insrt_date()
        since = mx
        mode_label = f"incremental (since Neon MAX insrt_date = {mx})"

    print(f"[sync_defect] mode = {mode_label}")
    print(f"[sync_defect] Q_FLAW_CKO063 조회 중...")
    src_rows = fetch_from_kystem(since)
    print(f"[sync_defect] 대상 {len(src_rows):,}건")

    if src_rows:
        dst_rows = [_row_to_dst(r) for r in src_rows]
        print(f"[sync_defect] 샘플 (최신 1건): {dst_rows[-1][0]} / plant={dst_rows[-1][8]} / gbn={dst_rows[-1][4]}")
    else:
        dst_rows = []

    if args.dry_run:
        print("[sync_defect] --dry-run: Neon 미반영")
        return 0

    if not dst_rows:
        print("[sync_defect] 신규 레코드 없음, 종료")
        return 0

    n = upsert_to_neon(dst_rows)
    print(f"[sync_defect] UPSERT 완료: {n:,}건")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)

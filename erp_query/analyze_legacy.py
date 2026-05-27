"""
item_codes(현재 Neon) 중 '생산 품목(produced)'에 없는 레거시 항목을 분석한다.
- ERP B_ITEM에 실존/유효한지
- 카테고리(품목그룹) 분포
- 샘플
읽기 전용. 아무것도 수정하지 않는다.
"""
import json
import os

import psycopg2
import db as erp_db

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def app_url():
    return json.load(open(os.path.join(_BASE, "PRIVATE", "app_db.json"), encoding="utf-8"))["database_url"]


def main():
    # 1) 현재 item_codes
    pg = psycopg2.connect(app_url())
    pc = pg.cursor()
    pc.execute("SELECT code, name, category FROM item_codes")
    current = {r[0]: (r[1], r[2]) for r in pc.fetchall()}
    pg.close()
    print(f"현재 item_codes: {len(current):,}건")

    # 2) ERP 연결
    erp = erp_db.connect(timeout=60)
    ec = erp.cursor()

    # 생산 품목(produced) 코드 집합
    ec.execute("""
        SELECT i.ITEM_CD FROM B_ITEM i
        WHERE i.VALID_FLG <> 'N'
          AND EXISTS (SELECT 1 FROM P_PRODUCTION_ORDER_HEADER h WHERE h.ITEM_CD = i.ITEM_CD)
    """)
    produced = {str(r[0]).strip() for r in ec.fetchall()}
    print(f"생산 품목(produced): {len(produced):,}건")

    # 전체 B_ITEM 코드 + 유효여부
    ec.execute("SELECT ITEM_CD, VALID_FLG FROM B_ITEM")
    erp_all = {}
    for cd, vf in ec.fetchall():
        erp_all[str(cd).strip()] = (vf or "").strip()
    erp.close()
    print(f"ERP B_ITEM 전체: {len(erp_all):,}건")

    # 3) 분류
    legacy = [c for c in current if c not in produced]   # produced에 없는 = 레거시
    overlap = len(current) - len(legacy)
    print(f"\n현재 ∩ 생산(겹침): {overlap:,}건")
    print(f"레거시(생산에 없음): {len(legacy):,}건")

    in_erp_valid = [c for c in legacy if c in erp_all and erp_all[c] != "N"]
    in_erp_invalid = [c for c in legacy if c in erp_all and erp_all[c] == "N"]
    not_in_erp = [c for c in legacy if c not in erp_all]

    print(f"  ├ ERP에 실존·유효 : {len(in_erp_valid):,}건  (정상 품목, 단지 현재 생산 안 함)")
    print(f"  ├ ERP에 있으나 무효(VALID_FLG=N): {len(in_erp_invalid):,}건  (폐기/단종)")
    print(f"  └ ERP에 아예 없음 : {len(not_in_erp):,}건  (사라진/엉뚱한 코드)")

    # 카테고리 분포 (레거시)
    from collections import Counter
    cat = Counter(current[c][1] for c in legacy)
    print("\n레거시 카테고리(품목그룹) 상위 12:")
    for k, v in cat.most_common(12):
        print(f"   {v:5d}  {k}")

    def sample(label, codes, n=8):
        print(f"\n[{label}] 샘플 {min(n,len(codes))}건:")
        for c in codes[:n]:
            print(f"   {c:18s} {current[c][0][:42]:44s} [{current[c][1]}]")

    sample("ERP에 없음(의심)", not_in_erp)
    sample("ERP 무효(단종)", in_erp_invalid)
    sample("ERP 정상(생산만 안함)", in_erp_valid)


if __name__ == "__main__":
    main()

"""
ERP 동기화 공통 필터 — 완성품만 남기고 브레이커/부품/공통그룹 제외.

3개 sync 스크립트(sync_items.py / sync_orders.py / sync_shipments.py)에서 동일하게 사용.
정책 변경 시 이 파일만 수정하면 전부 일관 적용됨.

기준 (NCR 부적합 보고 대상으로 의미 있는 완성품):
- ITEM_ACCT='10'  (일반 완성품 회계계정)
- 또는 ITEM_ACCT='20' AND 카테고리가 SCS/SCK/WHX/WTX (특장차/카체이서 완성품)
- 제외: 카테고리 SB*/SQ*/SU+* (브레이커 시리즈)

주의: 2026-07 정책 변경 — 사용자 요청으로 이관/기타/공통 그룹(아산시스템
      이관 품목그룹, 기타(공용코드), AT공통, DC공통) 제외 조건을 삭제해
      옛 모델·특수차량(A100, MP-1, MPN-170, SAD-14000, Z-080 등)도 검색
      대상에 포함. 이 그룹 완성품이 약 314건 존재하며 K-System 원본에도
      실제 등록된 완성품임을 확인.

주의: SD-* 그룹(SD-25, SD-530E, SD-530L)은 어스드릴/유압드릴 완성품.
      브레이커가 아니므로 예전 NOT LIKE 'SD-%' 제외는 오탐이었고 2026-07 삭제함.
      실 검증: K-System 원본에 SD-25/530E/530L 그룹 완성품(ITEM_ACCT=10) 존재.
      진짜 브레이커는 SB* 그룹(SB10, SB43, SB50 등)으로 별개.
- 제외: ITEM_NM에 'BREAKER' 들어간 것

SQL 사용 컨텍스트:
  FROM B_ITEM i LEFT JOIN B_ITEM_GROUP g ON g.ITEM_GROUP_CD = i.ITEM_GROUP_CD
  WHERE ... AND ({FINISHED_GOOD_WHERE}) ...
"""

# B_ITEM alias = i, B_ITEM_GROUP alias = g 가정.
FINISHED_GOOD_WHERE = """
  i.VALID_FLG <> 'N'
  AND (
        i.ITEM_ACCT = '10'
     OR (i.ITEM_ACCT = '20' AND (
              COALESCE(g.ITEM_GROUP_NM, '') LIKE 'SCS%'
           OR COALESCE(g.ITEM_GROUP_NM, '') LIKE 'SCK%'
           OR COALESCE(g.ITEM_GROUP_NM, '') LIKE 'WHX%'
           OR COALESCE(g.ITEM_GROUP_NM, '') LIKE 'WTX%'
        ))
  )
  AND COALESCE(g.ITEM_GROUP_NM, '') NOT LIKE 'SB%'
  AND COALESCE(g.ITEM_GROUP_NM, '') NOT LIKE 'SQ%'
  AND COALESCE(g.ITEM_GROUP_NM, '') NOT LIKE 'SU+%'
  AND i.ITEM_NM NOT LIKE '%BREAKER%'
"""

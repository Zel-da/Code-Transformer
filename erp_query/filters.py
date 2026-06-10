"""
ERP 동기화 공통 필터 — 완성품만 남기고 브레이커/부품/공통그룹 제외.

3개 sync 스크립트(sync_items.py / sync_orders.py / sync_shipments.py)에서 동일하게 사용.
정책 변경 시 이 파일만 수정하면 전부 일관 적용됨.

기준 (NCR 부적합 보고 대상으로 의미 있는 완성품):
- ITEM_ACCT='10'  (일반 완성품 회계계정)
- 또는 ITEM_ACCT='20' AND 카테고리가 SCS/SCK/WHX/WTX (특장차/카체이서 완성품)
- 제외: 카테고리 SB*/SQ*/SD-*/SU+* (브레이커 시리즈)
- 제외: 카테고리 공통/이관 그룹 (아산시스템 이관, 기타(공용코드), AT공통, DC공통)
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
  AND COALESCE(g.ITEM_GROUP_NM, '') NOT LIKE 'SD-%'
  AND COALESCE(g.ITEM_GROUP_NM, '') NOT LIKE 'SU+%'
  AND COALESCE(g.ITEM_GROUP_NM, '') NOT IN
      ('아산시스템 이관 품목그룹', '기타(공용코드)', 'AT공통', 'DC공통')
  AND i.ITEM_NM NOT LIKE '%BREAKER%'
"""

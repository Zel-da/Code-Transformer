# ERP 조회 (읽기 전용)

ERP 본 DB(영림원 K-System, SQL Server `SOOSANHI`)에 **읽기 전용**으로 직접 붙어
제조오더·품목·호기 데이터를 조회한다. NCR 부적합 보고서의 자동입력 데이터 소스.

## 환경
- Python 3.13, `pyodbc`(또는 `pymssql`), ODBC Driver 17 for SQL Server (이 PC에 설치됨)
- 접속정보: 저장소 루트 `PRIVATE/erp_db.json` (**gitignore됨 — 평문 비번 커밋 금지**)

## 도구

| 파일 | 용도 |
|---|---|
| `db.py` | DB 연결 헬퍼 (PRIVATE/erp_db.json 사용) |
| `fetch_input.py` | **제품+출하호기 → NCR 자동입력 데이터** (메인) |
| `find_order.py` | 제품+호기 → 제조오더 현황 조회 |
| `explore*.py` | 스키마 탐색 (개발/참고용) |

## fetch_input — 제품 + 출하호기로 나머지 입력 데이터 가져오기

```bash
python fetch_input.py --item-cd T8NH-0000000-00 --hogi 365   # 품번 + 출하호기
python fetch_input.py --product "T-380N" --hogi 365          # 품명/품번 부분일치(후보 안내)
python fetch_input.py --item-cd T8NH-0000000-00 --hogi 365 --json   # 앱 연동용 JSON
```

가져오는 값 (NCR 폼 필드 ← ERP):
- `modelName`(제품명) ← `B_ITEM.ITEM_NM`
- `itemGroup`(품목그룹) ← `B_ITEM_GROUP.ITEM_GROUP_NM`
- `spec`/`itemClass`/`itemAcct` ← `B_ITEM`
- `factory`/`plantCd` ← 제조오더 `P_PRODUCTION_ORDER_HEADER.PLANT_CD` (SA00→아산, SH00→화성)
- `matchedOrders` ← 품번+호기에 매칭되는 제조오더(번호/상태/일자)

## 핵심 테이블
- `P_PRODUCTION_ORDER_HEADER` — 제조오더(메뉴: 생산관리>제조오더관리>제조오더현황조회).
  품번 `ITEM_CD`, 호기 범위 `FROM_HOGI_KO368`~`TO_HOGI_KO368`(정수, **숫자 비교**), 공장 `PLANT_CD`.
- `B_ITEM` — 품목마스터(품번/품명/규격/품목그룹코드/분류)
- `B_ITEM_GROUP` — 품목그룹(코드→명, 계층)

> 주의: 계정 `voc_idea_if`는 읽기 전용. 데이터 조회 전용이며 ERP 쓰기는 불가.

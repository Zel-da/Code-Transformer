# 이 PC 배포 구성 (ERP 연동)

ERP 본 DB가 이 PC 망에서만 접근되므로, 조회 API와 일일 동기화 모두 이 PC에서 구동한다.

## 1. 가상환경
```powershell
python -m venv C:\Users\Administrator\Downloads\Code-Transformer\.venv
C:\Users\Administrator\Downloads\Code-Transformer\.venv\Scripts\python.exe -m pip install -r erp_query\requirements.txt
```

## 2. 자격증명 (PRIVATE/, gitignore)
- `PRIVATE/erp_db.json` — ERP SQL Server (읽기전용)
- `PRIVATE/app_db.json` — 앱 PostgreSQL: `{"database_url": "postgresql://postgres@127.0.0.1:5432/ncr"}`

## 3. 조회 API — 상시 서비스 (NSSM)
서비스명 `ErpQueryApi`, 자동시작, 크래시 시 재시작, `0.0.0.0:8900`.
```powershell
nssm install ErpQueryApi <venv>\Scripts\python.exe
nssm set ErpQueryApi AppParameters "-m uvicorn api:app --host 0.0.0.0 --port 8900"
nssm set ErpQueryApi AppDirectory  <repo>\erp_query
nssm set ErpQueryApi Start SERVICE_AUTO_START
nssm start ErpQueryApi
# 로그: C:\ProgramData\ErpQueryApi\service.log / service.err.log
# 헬스: http://localhost:8900/health
```

## 4. 일일 품목 동기화 (Task Scheduler)
작업명 `ErpItemSync`, 매일 05:00, SYSTEM 계정. `run_sync.bat` → `sync_items.py --scope produced`.
ERP `B_ITEM`(제조오더 보유 품목 ~7,900건) → 로컬 `ncr.item_codes` upsert.
```powershell
schtasks /create /tn ErpItemSync /tr <repo>\erp_query\run_sync.bat /sc DAILY /st 05:00 /ru SYSTEM /rl HIGHEST /f
schtasks /run /tn ErpItemSync        # 수동 1회 실행
# 로그: C:\ProgramData\ErpQueryApi\sync.log
```

## 5. 프런트엔드 연동
`artifacts/ncr-app` 빌드 시 환경변수:
```
VITE_ERP_API_BASE=http://<이 PC 주소>:8900
```
submit.tsx가 제품코드+출하호기 입력 시 `/api/erp/input-data`를 호출해 제품명·공장 자동채움.

## ⚠ 앱 DB 연결 (남은 작업)
현재 동기화 대상은 **로컬 `ncr` DB**이고, `item_codes` 테이블만 생성돼 있다.
앱(api-server)이 이 데이터를 실제로 쓰려면:
1. api-server의 `DATABASE_URL`을 `postgresql://postgres@127.0.0.1:5432/ncr`로 지정
2. 전체 스키마 생성: `pnpm --filter @workspace/db run db:push` (item_codes 외 나머지 테이블)

## 제거(롤백)
```powershell
nssm stop ErpQueryApi; nssm remove ErpQueryApi confirm
schtasks /delete /tn ErpItemSync /f
```

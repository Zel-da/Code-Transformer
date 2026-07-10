<!--
title: IT / 관리자 상세 가이드
role: admin
subtitle: 아키텍처 · 배포 · 모니터링 · 트러블슈팅 · 데이터 복구
-->

<div class="doc-header">
NCR 시스템의 <strong>전체 기술 지형</strong>. 배포·모니터링·긴급 복구까지.
</div>

## 1. 시스템 아키텍처

### 1.1 모노레포 구조

```
Code-Transformer/
├── artifacts/
│   ├── ncr-app/          ← React+Vite 프런트 (모바일/PC 폼)
│   ├── api-server/       ← Express+Drizzle 백엔드
│   ├── ncr-mobile/       ← 별도 모바일 (일부)
│   └── mockup-sandbox/   ← 목업/샌드박스
├── lib/
│   ├── db/               ← Drizzle 스키마 (Postgres)
│   ├── api-spec/         ← OpenAPI 3.0 + orval 코드젠
│   ├── api-zod/          ← 자동생성 zod 스키마
│   ├── api-client-react/ ← 자동생성 React 클라이언트
│   └── object-storage-web/ ← 파일 업로드 (Replit Object Storage)
├── erp_query/            ← Python, K-System → Neon 동기화 (사내 PC)
├── rpa-ncr/              ← Python, 사용 중인 RPA 워커
├── rpa/                  ← 옛 폴더 (deprecated)
└── PRIVATE/              ← 시크릿 (gitignore)
```

### 1.2 데이터 흐름

```
[사용자 폼]
    ↓ HTTPS
[Replit ncr-app]
    ↓ /api/*
[Replit api-server]
    ↓ Drizzle ORM
[Neon Postgres]
    ↑ 4회/일 동기화
[사내 PC erp_query]
    ↑ pyodbc/pymssql
[K-System SQL Server (SOOSANHI)]

[Replit api-server]
    ↑ HTTP polling
[사내 PC rpa-ncr worker]
    ↓ pywinauto UIA
[UNIERP 데스크톱 앱]
```

### 1.3 배포 타깃

| 컴포넌트 | 배포 | 재시작 방법 |
|---|---|---|
| ncr-app | Replit autoscale | Replit 대시보드 |
| api-server | Replit autoscale | 자동 (deployment 시) |
| Neon | Neon Cloud (관리 서비스) | 콘솔 |
| erp_query API | 사내 PC, NSSM 서비스 (`ErpQueryApi`) | `net start/stop ErpQueryApi` |
| erp_query 동기화 | 사내 PC, Task Scheduler (`ErpItemSync`) | `Start-ScheduledTask -TaskName ErpItemSync` (수동 즉시 실행) |
| rpa-ncr 워커 | 사내 PC, `시작.bat` | 재실행 |

## 2. 시크릿 · 접속 관리

### 2.1 PRIVATE 폴더 (사내 PC, gitignore)

| 파일 | 내용 |
|---|---|
| `PRIVATE/erp_db.json` | K-System 접속 (`server`, `database=SOOSANHI`, `uid`, `pwd`, `api_key`) |
| `PRIVATE/app_db.json` | Neon 접속 URL |
| `PRIVATE/notify.json` | 슈산톡 웹훅 URL (동기화 실패 알림) |

<blockquote class="warn">
[!warn] 이 파일들엔 <strong>평문 비밀번호</strong> 들어있음. 절대 이메일·채팅·공유폴더 X.
USB 전달만.
</blockquote>

### 2.2 Replit Secrets

| 키 | 용도 |
|---|---|
| `DATABASE_URL` | Neon 접속 |
| `SESSION_SECRET` | 세션 서명 |
| `RPA_STALE_PROCESSING_MINUTES` *(선택)* | T1 임계값 (기본 300) |
| `WEBHOOK_QC_URL`, `WEBHOOK_LAB_URL` | 슈산톡 채널 |
| `NCR_API_SECRET` *(선택)* | RPA ↔ API 인증 (`X-RPA-Secret`) |

### 2.3 사내 PC API (`ErpQueryApi` 서비스, port 8900)

- **LAN 한정**: 미들웨어가 private IP 만 허용 (`127.0.0.1`, `10.*`, `172.16-31.*`, `192.168.*`)
- **API 키 강제**: `X-ERP-KEY` 헤더 없으면 401. 키 없으면 503 (구성 오류)
- 키는 `PRIVATE/erp_db.json` 의 `api_key` (43자 URL-safe, 자동 생성)

## 3. 상태 관리

### 3.1 syncStatus 전이

```
PENDING ──┐
    ↑     ↓ RPA 조회
    │  PROCESSING ──→ REVIEW ──→ COMPLETED
    │     │             │
    │     │             │ 사용자 [실패] 시
    │     └─→ FAILED ←──┘
    │         │
    └─── 5시간 자동회수 (T1)
```

### 3.2 qcStatus 전이 (QC 워크플로)

```
OPEN → IN_REVIEW → PENDING_COLLAB ↔ IN_REVIEW → RESOLVED → APPROVED → ERP_SYNCED
```

### 3.3 상태별 액션 매트릭스

| 상태 | 자동 액션 | 담당 |
|---|---|---|
| PENDING (신규) | RPA 다음 폴링에 조회됨 | RPA |
| PENDING (자동회수됨) | 재시도 카운트 증가한 채 조회됨 | RPA |
| PROCESSING | 5시간 후 자동 PENDING 복원 | 자동 |
| REVIEW | 사용자 확인 대기, DB 에 영속 | RPA 운영자 |
| COMPLETED | 종결 | — |
| FAILED | 재시도 로직 없음 (수동) | 관리자·QC |

## 4. 동기화 스케줄 (Windows Task Scheduler)

### 4.1 현재 트리거

```powershell
Get-ScheduledTask -TaskName "ErpItemSync" | Select-Object -ExpandProperty Triggers
```

- 05:00, 10:00, 12:30, 17:00 (하루 4회)

### 4.2 시간 변경

```powershell
$triggers = @(
    (New-ScheduledTaskTrigger -Daily -At "5:00AM"),
    (New-ScheduledTaskTrigger -Daily -At "10:00AM"),
    (New-ScheduledTaskTrigger -Daily -At "12:30PM"),
    (New-ScheduledTaskTrigger -Daily -At "5:00PM")
)
Set-ScheduledTask -TaskName "ErpItemSync" -Trigger $triggers
```

### 4.3 즉시 수동 실행

```powershell
Start-ScheduledTask -TaskName "ErpItemSync"
```

또는:

```powershell
cd C:\Users\Administrator\Downloads\Code-Transformer\erp_query
python run_all.py
```

### 4.4 4단계별 소요

| 단계 | 처리 대상 | 소요 (실측) |
|---|---|---|
| items | ~1,145건 upsert | ~5초 |
| orders | ~264건 upsert | ~3초 |
| vendors | ~80,140건 upsert | ~23초 |
| shipments | ~12,481건 TRUNCATE+INSERT | ~5초 |
| **총** | — | **35~40초** |

## 5. 로그·모니터링

### 5.1 로그 위치

| 서비스 | 위치 |
|---|---|
| API 서버 (Replit) | Replit 콘솔 |
| erp_query 동기화 | `C:\ProgramData\ErpQueryApi\sync.log` |
| erp_query API 서비스 | Windows Event Viewer (NSSM ErpQueryApi) |
| rpa-ncr 워커 | `rpa-ncr/logs/rpa_ncr_YYYY-MM-DD.log` (5개 회전) |

### 5.2 모니터링 SQL

```sql
-- 각 상태별 카운트 + 최신 업데이트 시각
SELECT sync_status, COUNT(*), MAX(updated_at)
FROM non_conformity_reports
GROUP BY sync_status
ORDER BY 1;

-- 지금 갇힌 것으로 보이는 것 (5시간 초과 PROCESSING)
SELECT id, ncr_number, item_code, updated_at,
       EXTRACT(EPOCH FROM (now() - updated_at)) / 60 AS age_minutes
FROM non_conformity_reports
WHERE sync_status = 'PROCESSING'
  AND updated_at < now() - interval '300 minutes'
ORDER BY updated_at;

-- REVIEW 24시간 이상
SELECT id, ncr_number, updated_at
FROM non_conformity_reports
WHERE sync_status = 'REVIEW'
  AND updated_at < now() - interval '24 hours';

-- 최근 실패
SELECT id, ncr_number, sync_last_error, updated_at
FROM non_conformity_reports
WHERE sync_status = 'FAILED'
  AND updated_at > now() - interval '48 hours'
ORDER BY updated_at DESC;

-- 자동회수된 이력 (sync_last_error 포함)
SELECT id, sync_status, sync_attempt_count, sync_last_error
FROM non_conformity_reports
WHERE sync_last_error LIKE '%auto-recovered%'
ORDER BY updated_at DESC LIMIT 20;
```

### 5.3 K-System 접속 확인

```powershell
# 사내 PC 에서
Test-NetConnection -ComputerName <k-system-server> -Port 1433
```

## 6. T1 자동회수 상세

### 6.1 동작

- `GET /api/reports/pending` 응답 전에:
  - `PROCESSING` + `updated_at < now() - N분` UPDATE → PENDING
  - `sync_last_error` 에 자동 복원 표시
  - `sync_attempt_count` 증가
- 동시에 `DbSource.fetch_pending()` 도 자체 recovery (RPA 가 DB source 로 동작 시)

### 6.2 임계값 조절

- 환경변수 `RPA_STALE_PROCESSING_MINUTES` (기본 300 = 5시간)
- 최소 1분, 상한 없음 (하지만 5분 미만은 오탐 위험)
- Replit 에서 설정 후 재배포

### 6.3 조작 필요 없음

- 이제 갇힌 보고는 수동으로 DB 열지 않아도 됨
- 로그에서 확인:
  `[reports/pending] stale PROCESSING 자동 복원: N건 → PENDING (임계값 300분). ids=8,11,15`

## 7. T2 REVIEW 상세

### 7.1 DB 승격 시점

- RPA 워커가 UNIERP 저장 완료 직후 `source.mark_review(report.id)` 호출
- 상태: <span class="tag tag-processing">PROCESSING</span> → <span class="tag tag-review">REVIEW</span>

### 7.2 큐 복원

- `GET /api/erp/review` 호출 시 큐가 비었으면 `fetch_review()` 로 DB 스캔
- REVIEW 상태 보고를 큐에 restore (`restored: true` 플래그)
- 워커 실행 중일 땐 hydrate 안 함 (레이스 방지)

### 7.3 확인 → COMPLETED

- 사용자가 검토 UI 에서 [확인] → `mark_completed` → COMPLETED
- 실패 처리 원하면 [실패] → `mark_failed`

## 8. 트러블슈팅 시나리오

### 8.1 동기화 실패 알림 왔음

1. 사내 PC 에서 `C:\ProgramData\ErpQueryApi\sync.log` 최신 확인
2. 마지막 traceback 파악
3. K-System 네트워크 문제면 잠깐 뒤 재시도 자동
4. 인증 문제면 `PRIVATE/erp_db.json` 재확인
5. 즉시 재실행: `Start-ScheduledTask -TaskName ErpItemSync`

### 8.2 앱 사용자가 부품코드 검색 안 됨

1. 방금 ERP 등록된 자재는 최대 5시간 lag (05·10·12:30·17시 동기화)
2. `SELECT * FROM item_codes WHERE code = '...'` 로 앱 DB 확인
3. 없으면 K-System 에는 있는지 담당자 확인
4. 급하면 수동 동기화 (6절)

### 8.3 다수 보고가 FAILED

1. `sync_last_error` 컬럼으로 원인 파악
2. UNIERP 창 좌표 어긋남 → RPA 운영자에게 캘리브 요청
3. UNIERP 팝업 무한 반복 → 로그의 팝업 이름 확인

### 8.4 REVIEW 오래 남음

1. RPA 운영자에게 확인 요청 (그가 대시보드에서 [완료 확인] 눌러야 함)
2. 정말 잘못됐다면 수동으로 상태 되돌림 (아래)

### 8.5 수동 상태 복원 (긴급)

<blockquote class="warn">
[!warn] 아래는 <strong>정말 필요할 때만</strong>. 자동 복구 로직이 도는지 확인 후.
</blockquote>

```sql
-- 특정 보고를 PENDING 으로 되돌림
UPDATE non_conformity_reports
SET sync_status = 'PENDING',
    sync_attempt_count = 0,
    sync_last_error = NULL,
    updated_at = now()
WHERE id = <REPORT_ID>;

-- 여러 개 FAILED 를 재시도 대상으로
UPDATE non_conformity_reports
SET sync_status = 'PENDING',
    updated_at = now()
WHERE sync_status = 'FAILED' AND id IN (...);
```

## 9. 배포·업데이트

### 9.1 코드 배포

```bash
# 로컬 커밋 후
git push origin main
# Replit 이 자동 감지해서 재배포 (autoscale)
```

### 9.2 스키마 마이그레이션

- Drizzle 사용, `lib/db/src/schema/*.ts` 편집 후:
  - `pnpm --filter @workspace/db run generate` (마이그레이션 SQL 자동)
  - `pnpm --filter @workspace/db run push` (Neon 에 적용)
- `syncStatusEnum` 처럼 text 타입은 코드만 확장하면 되고 DB 마이그레이션 불요

### 9.3 openapi.yaml → 코드젠

- `lib/api-spec/openapi.yaml` 편집 후:
  - `pnpm --filter @workspace/api-spec run codegen`
- 이걸 안 돌리면 프런트 zod 스키마가 백엔드와 어긋남

## 10. 테스트

### 10.1 회귀 테스트 실행

```bash
pnpm --filter @workspace/api-server run test
```

- `artifacts/api-server/tests/erp.test.ts` — 5개 통합 케이스 (실 Neon 사용)
- vitest + supertest

### 10.2 프런트 테스트

- **없음** (알려진 갭). 폼 회귀는 QC 담당자가 수동 확인.

## 11. 최근 큰 사고 이력

| 시기 | 사고 | 원인 | 해결 |
|---|---|---|---|
| 2026-06-10 ~ 06-23 | 동기화 13일간 silent 실패 | cp949 인코딩 오류가 나머지 3단계 죽였고 알림 로직도 함께 죽음 | 인코딩·격리·exit code 전파 hardening |
| 2026-06 ~ | id=8,11,15 보고 갇힘 | RPA 크래시 후 PROCESSING 잔재 | 2026-07 T1 자동회수 도입 → 즉시 회수 |
| — | REVIEW 큐 손실 위험 | in-memory 저장 | 2026-07 T2 DB 승격 |

## 12. 아키텍처 결정 기록

| 결정 | 이유 |
|---|---|
| Neon Postgres (Replit 아님) | Replit DB 는 개발용, 프로덕션엔 Neon serverless |
| RPA 워커는 사내 PC | UNIERP GUI 가 사내망 데스크톱 앱 |
| 사내 PC API `LAN 한정` | K-System 접속을 외부에 노출 안 함 |
| 동기화 TRUNCATE+INSERT | 소스가 진실이라 upsert 보다 단순·정확 (vendors 는 UPSERT — 8만건 규모) |
| REVIEW 상태 도입 | 배치 검토 큐를 재시작 안전하게 |
| Docs 언어 한국어 | 실사용자·운영자 전원 한국어 |

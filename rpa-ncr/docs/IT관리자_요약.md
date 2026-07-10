<!--
title: IT / 관리자 요약
role: admin
subtitle: 전체 흐름 이해 + 자주 겪는 3가지 문제 대응
-->

<div class="doc-header">
NCR 시스템의 <strong>전체 구조·모니터링 포인트·긴급 대응</strong>. 자세한 것은
<a href="IT관리자_상세.html">상세</a>.
</div>

## 시스템 4계층

```
[Frontend]        [Backend]         [ETL]              [RPA Worker]
Vite+React      Express+Drizzle   Python              rpa-ncr
    │              │                │                   │
    │              ↓                ↓                   │
    └─→ REST → Neon Postgres ←─ 4회/일 ← K-System DB     │
                    │                                   │
                    └─────── polling ────────────→ UNIERP GUI
                             (반드시 사내망)
```

## 배포·실행 위치

| 계층 | 어디서 도는가 |
|---|---|
| ncr-app (프런트) | Replit autoscale |
| api-server | Replit autoscale |
| Neon Postgres | Neon Cloud (us-east-1) |
| erp_query (K-System 동기화) | 사내 PC 1대, Task Scheduler |
| rpa-ncr 워커 | 백승기 직장님 PC, 수동 실행 |

## 자주 겪는 문제 3가지

### 1. 동기화 실패 (Silent 아님, 알림 옴)
- **감지**: 슈산톡 웹훅으로 실패 알림 자동 발송
- **로그**: `C:\ProgramData\ErpQueryApi\sync.log` (Windows PC)
- **대응**: 로그의 마지막 traceback 확인. 대개 K-System 네트워크·인증 문제
- **역대 사고**: 2026-06 cp949 인코딩 문제로 13일 silent 실패 → 해결됨

### 2. PROCESSING 갇힘 (자동회수됨, 이제)
- **감지**: `syncStatus=PROCESSING` + `updated_at < 5시간 전` 카운트
- **대응**: **자동 복원됨** (2026-07 T1). 5시간 지나면 다음 조회에서 자동 PENDING
- **수동 확인**: `SELECT id, updated_at, sync_last_error FROM non_conformity_reports WHERE sync_status='PROCESSING'`

### 3. REVIEW 오래 남음
- **감지**: `syncStatus=REVIEW` 상태로 24시간 이상
- **원인**: RPA 운영자가 확인 안 하고 방치
- **대응**: RPA 운영자에게 확인 요청. DB 조작 필요 없음

## 모니터링 SQL 스니펫

```sql
-- 각 상태별 카운트
SELECT sync_status, COUNT(*)
FROM non_conformity_reports
GROUP BY sync_status;

-- 최근 24h 등록된 보고
SELECT id, ncr_number, sync_status, item_code, factory
FROM non_conformity_reports
WHERE created_at > now() - interval '24 hours'
ORDER BY created_at DESC;

-- REVIEW 상태 24h 이상 남은 것
SELECT id, ncr_number, updated_at
FROM non_conformity_reports
WHERE sync_status = 'REVIEW' AND updated_at < now() - interval '24 hours';
```

## 동기화 스케줄 (Windows Task Scheduler)

| 트리거 | 시각 |
|---|---|
| 야간 반영 | 05:00 |
| 오전 반영 | 10:00 |
| 점심 반영 | 12:30 |
| 오후 마감 전 | 17:00 |

수정: `Set-ScheduledTask -TaskName ErpItemSync -Trigger @(...)` (관리자 PowerShell)

## 시크릿·구성 파일 위치

| 파일 | 위치 | 내용 |
|---|---|---|
| `PRIVATE/erp_db.json` | 사내 PC (gitignore) | K-System 접속 (사용자·PW·서버) |
| `PRIVATE/app_db.json` | 사내 PC + Replit env | Neon 접속 URL |
| Replit secrets | Replit console | SESSION_SECRET, WEBHOOK_URL 등 |
| `PRIVATE/notify.json` | 사내 PC | 동기화 실패 알림 웹훅 |

## 긴급 대응

| 상황 | 즉시 조치 |
|---|---|
| 앱 다운 (Replit) | Replit 대시보드에서 재시작 |
| Neon DB 다운 | Neon 콘솔 상태 확인 |
| K-System 동기화 실패 알림 왔음 | sync.log 확인 → 재시도 (`python run_all.py` 수동) |
| 다수 보고가 <span class="tag tag-failed">FAILED</span> | RPA 운영자 문의. UNIERP 상태·좌표 캘리브 확인 |
| 사용자 로그인 안 됨 | Replit 로그 확인 → 필요 시 계정 재설정 |

→ [상세 가이드](IT관리자_상세.html)

<!--
title: QC 담당자 상세 가이드
role: qc
subtitle: 검토·조치·승인·모니터링의 모든 세부
-->

<div class="doc-header">
QC 담당자로서 알아야 할 <strong>워크플로 전체·상태 흐름·복구 시나리오</strong>까지.
</div>

## 1. 전체 워크플로

```
현장 작업자           QC 담당자             RPA 워커
    │                    │                    │
  [등록]              [검토]                   │
   PENDING           OPEN                     │
                    ↓                         │
                    IN_REVIEW ← 시작           │
                    ↓                         │
                    PENDING_COLLAB ← @태그    │
                    ↓                         │
                    RESOLVED                  │
                    ↓                         │
                    APPROVED ────────────→  [자동입력]
                                              PROCESSING
                                              ↓
                                              REVIEW ← 확인 대기
                                              ↓
                                              COMPLETED
                    ERP_SYNCED ←──────────────┘
```

## 2. 목록 화면 활용

### 2.1 기본 필터

- **동기화 상태** (`syncStatus`): PENDING / PROCESSING / REVIEW / COMPLETED / FAILED
- **QC 상태** (`qcStatus`): OPEN / IN_REVIEW / PENDING_COLLAB / RESOLVED / APPROVED / ERP_SYNCED
- **검색어**: 부품코드·제품명·거래처명·설명
- **날짜 범위**: 등록일 또는 발생일
- **결함타입** (`flawTypeCd`)
- **거래처** (`vendorCd`)

### 2.2 실용 필터 조합

| 하고 싶은 것 | 필터 |
|---|---|
| 오늘 등록된 미검토 | `qcStatus=OPEN` + 오늘 날짜 |
| 협업 대기 중인 것 | `qcStatus=PENDING_COLLAB` |
| ERP 반영 안 된 승인 건 | `qcStatus=APPROVED` + `syncStatus≠COMPLETED` |
| 실패한 보고 | `syncStatus=FAILED` |
| 갇힌 보고 (드묾) | `syncStatus=PROCESSING` + 5시간 이상 |

## 3. 개별 보고 검토

### 3.1 확인·수정 가능한 필드 전체

**부적합 기본**:
- 부품코드, 제품명, 모델명
- 공정 (공장에 종속)
- 발생일, 불량수량
- 상세 설명

**QC 전용 (등록 시엔 비어있어도 됨)**:
- 결함타입 코드 (`flawTypeCd`) — 드롭다운
- 손실공수 (`lostManHours`) — 시간 단위 실수
- 부서 코드 (`deptCd`)
- 담당자 코드/명 (`managerCd`, `managerNm`)
- 거래처 (`vendorCd`, `vendorNm`)
- 품목그룹 (`itemGroup`)
- 조치방향 (`actionDirection`)
- 비고 (`remarks`)
- 출하기간 시작/종료 (`shipmentDateFrom`, `shipmentDateTo`)

### 3.2 필수 vs 선택

RPA 가 UNIERP 에 입력할 때 **비어 있으면 UNIERP 필드도 비운 채 진행**합니다.
QC 관점에서 **꼭 채워야 하는 것**:

1. **결함타입** — 통계·분석 핵심
2. **손실공수** — 원가 반영
3. **거래처** — 협력사 성적 관리
4. **조치방향** — 재발 방지

## 4. 코멘트·협업

### 4.1 코멘트 규칙

- 마크다운 지원 (**굵게**, `코드`, - 목록)
- `@이름` 으로 사용자 태그 → 자동 알림
- 편집 표시 (`isEdited=true`)

### 4.2 상태 자동 전이

`@태그` 를 포함한 코멘트를 남기면 상태가 자동으로 `PENDING_COLLAB` 로 바뀌고 슈산톡 알림이 태그된 사람에게 발송됩니다.

태그된 사람의 응답 코멘트가 들어오면 담당자가 판단해서 다시 `IN_REVIEW` → `RESOLVED` → `APPROVED` 순으로 진행.

## 5. 승인(APPROVED) 시 무슨 일이

`qcStatus=APPROVED` 로 저장하면:

1. **감사 로그** 자동 기록 (누가, 언제, 무엇을 승인)
2. **RPA 워커** 가 다음 폴링에서 이 보고를 조회 대상에 포함
3. RPA 가 UNIERP 자동입력 시작 → 상태 <span class="tag tag-processing">PROCESSING</span>

## 6. RPA 반영 후 상태 흐름 (2026-07 이후)

### 6.1 정상 흐름

```
APPROVED (QC)
    ↓ RPA 조회
PROCESSING
    ↓ UNIERP 입력·저장 성공
REVIEW ← 여기서 사용자가 UNIERP 화면 확인 → [확인 버튼]
    ↓
COMPLETED
    ↓ (별도 프로세스)
ERP_SYNCED (QC 관점)
```

### 6.2 T1 자동회수 (신규)

<blockquote class="info">
[!info] RPA 프로세스가 크래시·네트워크 단절로 죽으면 보고가
<span class="tag tag-processing">PROCESSING</span> 상태에 갇혔었습니다.
2026-07 부터 <strong>5시간 초과하면 자동으로</strong>
<span class="tag tag-pending">PENDING</span> 으로 복원됩니다.
</blockquote>

- 복원 표시: `sync_last_error` 컬럼에 `[auto-recovered] PROCESSING > 300분 경과...` 기록
- 담당자가 아무것도 안 해도 다음 RPA 폴링에서 자동 재시도됨

### 6.3 T2 REVIEW 상태 (신규)

<blockquote class="info">
[!info] UNIERP 저장은 됐지만 확인 못 받은 보고는
<span class="tag tag-review">REVIEW</span> 상태로 남습니다.
서버·브라우저 재시작해도 사라지지 않음.
</blockquote>

- RPA 운영자가 검토 UI 에서 [확인] 눌러야 <span class="tag tag-completed">COMPLETED</span> 로 전이
- <span class="tag tag-review">REVIEW</span> 가 오래 남아 있으면 RPA 운영자에게 문의

## 7. 실패 케이스 대응

### <span class="tag tag-failed">FAILED</span> 상태 보고

**의미**: UNIERP 입력 도중 실패 (팝업·포커스 이탈·필드 오류 등)
**정보**: `sync_last_error` 에 실패 이유 기록됨
**대응**:
1. 이유 확인 → 폼 필드 문제면 QC 담당이 수정
2. 시스템 문제면 RPA 운영자·IT 관리자에게
3. 수정 완료 → 상태를 다시 <span class="tag tag-pending">PENDING</span> 으로 되돌리는 API (RPA 운영자가 조작)

### RPA 반영 안 되는 승인 건

`qcStatus=APPROVED` 인데 <span class="tag tag-completed">COMPLETED</span> 로 안 감:

- **RPA 워커 실행 안 됨** → RPA 운영자에게 시작.bat 실행 요청
- **UNIERP 창 닫힘·로그아웃** → RPA 운영자 확인
- **필드 좌표 어긋남** → RPA 운영자가 캘리브레이션

## 8. 월별 마감·집계

- 매월 초 관리자가 전월 마감 처리
- QC 담당자 통계:
  - 결함 유형별 건수
  - 거래처별 건수·손실공수
  - 공정별 발생 빈도

## 9. 자주 하는 질문

**Q. 검토 도중 다른 담당자가 이미 수정했으면?**
A. 마지막 저장자가 이김 (감사 로그로 이력 추적 가능).

**Q. 사진이 안 보임.**
A. 오브젝트 스토리지 만료. IT 관리자에게 문의.

**Q. 실수로 승인했음.**
A. 승인 취소 UI 는 없음. RPA 가 처리 중이면 RPA 운영자에게 중지 요청, PENDING 이면 IT 관리자에게 상태 되돌림 요청.

**Q. 코멘트를 삭제 가능?**
A. 편집만 가능 (isEdited 표시됨). 감사 목적 삭제 불가.

**Q. 알림이 안 옴.**
A. 사용자 설정(`notifyLevel`)이 `none` 이거나 슈산톡 웹훅 문제. IT 관리자.

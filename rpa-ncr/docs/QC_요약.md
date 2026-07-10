<!--
title: QC 담당자 요약
role: qc
subtitle: 등록된 보고 검토 → 조치방향 결정 → UNIERP 반영까지
-->

<div class="doc-header">
현장에서 등록한 <strong>부적합 보고를 검토·보완·승인</strong> 하는 역할.
자세한 설명은 <a href="QC_상세.html">상세</a>에.
</div>

## 하루 흐름

1. **알림 확인**: 슈산톡/이메일로 신규 보고 알림 옴
2. **웹에서 로그인** → 목록에서 <span class="tag tag-pending">PENDING</span> 상태 보고 확인
3. **각 보고 열어 검토**:
   - 부품·거래처·불량유형·손실공수 등 확인·보완
   - 조치방향 확정
4. **승인** (`QC 상태 = APPROVED`) → RPA 가 자동으로 UNIERP 에 입력

## QC 상태 요약

| 상태 | 의미 |
|---|---|
| OPEN | 등록 직후, 미검토 |
| IN_REVIEW | 검토 중 |
| PENDING_COLLAB | 다른 부서·담당자 협업 필요 (`@태그`) |
| RESOLVED | 검토·조치 완료 |
| APPROVED | 승인 → RPA 대상 |
| ERP_SYNCED | UNIERP 반영 완료 |

## 검토 시 채우는 필드

폼 등록자가 놓친 필드를 보완:

- 불량유형 코드 (`flaw_type_cd`)
- 손실공수 (`lost_man_hours`, 시간 단위)
- 부서 코드
- 담당자
- 거래처 (등록 시 자동채움 안 된 경우)
- 품목그룹 (자동채움 안 된 경우)
- 조치방향 확정 / 비고

## 협업 요청 방법

- 다른 사람 확인 필요 → **코멘트**에서 `@이름` 태그
- 상태 자동으로 `PENDING_COLLAB` 로 변경 → 태그된 사람에게 슈산톡 알림
- 답변 오면 다시 검토·승인

## 알아둘 것

<blockquote class="info">
[!info] <strong>승인 후 상태 흐름</strong>:
<span class="tag tag-pending">PENDING</span> → <span class="tag tag-processing">PROCESSING</span>
→ <span class="tag tag-review">REVIEW</span> → <span class="tag tag-completed">COMPLETED</span> (RPA 자동)
</blockquote>

<blockquote class="warn">
[!warn] <span class="tag tag-processing">PROCESSING</span> 상태가 <strong>5시간 넘게</strong>
안 바뀌면 자동으로 <span class="tag tag-pending">PENDING</span> 로 복원됨 (2026-07 도입).
이제 갇힌 보고 손으로 풀 필요 없음.
</blockquote>

## 자주 하는 것

- **보고 내용 수정**: 원 등록자가 잘못 넣으면 QC 담당이 수정 가능
- **일괄 확인**: 목록에서 필터로 `qcStatus=OPEN` 만 보고 처리
- **월별 마감**: 담당자만 가능한 종결 처리 (매월 초)

## 문의 대상

| 상황 | 문의 |
|---|---|
| UNIERP 에 안 들어감 (오랫동안 REVIEW) | RPA 운영자 |
| 자동채움 오류 (틀린 거래처 매칭) | IT/관리자 |
| 계정·권한 | IT/관리자 |
| 등록자 문의 (실수 등록) | 원 등록자 (코멘트) |

→ [상세 가이드로](QC_상세.html)
